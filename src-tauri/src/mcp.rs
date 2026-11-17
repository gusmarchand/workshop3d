// Serveur MCP local : un assistant (Claude Code, par exemple) lit le projet ouvert et le modifie.
// Transport « Streamable HTTP » réduit au strict nécessaire : POST /mcp, réponse JSON, pas de flux SSE.
// Sécurité : écoute sur 127.0.0.1 seulement, jeton obligatoire, en-têtes Host et Origin vérifiés
// (contre le DNS rebinding depuis une page web).
// Rust ne connaît que le protocole : la liste des outils et leur exécution vivent côté interface (src/mcp.ts),
// qui reçoit chaque requête par l'événement `mcp` et répond avec la commande `mcp_reply`.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

pub const PORT: u16 = 41733;
const MAX_CORPS: usize = 2 * 1024 * 1024;
const DELAI_INTERFACE: Duration = Duration::from_secs(30);

#[derive(Default)]
pub struct Mcp {
    attente: Mutex<HashMap<u64, Sender<Value>>>,
    suivant: AtomicU64,
}

/// Réponse de l'interface à une requête transmise : `{ result }` ou `{ error: { code, message } }`.
#[tauri::command]
pub fn mcp_reply(state: State<'_, Arc<Mcp>>, id: u64, reponse: Value) {
    if let Some(tx) = state.attente.lock().unwrap().remove(&id) {
        let _ = tx.send(reponse);
    }
}

/// Jeton lu dans `dossier/mcp-token`, créé au premier lancement (lisible par l'utilisateur seul).
fn jeton(dossier: &Path) -> std::io::Result<String> {
    let f = dossier.join("mcp-token");
    if let Ok(t) = std::fs::read_to_string(&f) {
        let t = t.trim().to_string();
        if t.len() >= 32 {
            return Ok(t);
        }
    }
    let mut octets = [0u8; 32];
    getrandom::fill(&mut octets).map_err(|e| std::io::Error::other(e.to_string()))?;
    let t: String = octets.iter().map(|b| format!("{b:02x}")).collect();
    std::fs::create_dir_all(dossier)?;
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut o, 0o600);
    o.open(&f)?.write_all(t.as_bytes())?;
    Ok(t)
}

pub fn demarrer(app: AppHandle, dossier: &Path, mcp: Arc<Mcp>) {
    let jeton = match jeton(dossier) {
        Ok(t) => Arc::new(t),
        Err(e) => return eprintln!("MCP désactivé : jeton impossible à créer ({e})"),
    };
    let ecoute = match TcpListener::bind(("127.0.0.1", PORT)) {
        Ok(l) => l,
        Err(e) => return eprintln!("MCP désactivé : port {PORT} indisponible ({e})"),
    };
    std::thread::spawn(move || {
        for flux in ecoute.incoming().flatten() {
            let (app, mcp, jeton) = (app.clone(), mcp.clone(), jeton.clone());
            std::thread::spawn(move || {
                let _ = connexion(flux, &app, &mcp, &jeton);
            });
        }
    });
}

struct Requete {
    methode: String,
    chemin: String,
    entetes: HashMap<String, String>,
    corps: Vec<u8>,
}

fn lire_requete(r: &mut BufReader<TcpStream>) -> std::io::Result<Option<Requete>> {
    let mut ligne = String::new();
    if r.read_line(&mut ligne)? == 0 {
        return Ok(None);
    }
    let mut p = ligne.split_whitespace();
    let methode = p.next().unwrap_or("").to_string();
    let chemin = p.next().unwrap_or("").to_string();
    let mut entetes = HashMap::new();
    loop {
        let mut l = String::new();
        if r.read_line(&mut l)? == 0 || l.trim().is_empty() {
            break;
        }
        if entetes.len() > 100 || l.len() > 8192 {
            return Err(std::io::Error::other("en-têtes trop longs"));
        }
        if let Some((k, v)) = l.split_once(':') {
            entetes.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    let n: usize = entetes.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    if n > MAX_CORPS {
        return Err(std::io::Error::other("corps trop gros"));
    }
    let mut corps = vec![0; n];
    r.read_exact(&mut corps)?;
    Ok(Some(Requete { methode, chemin, entetes, corps }))
}

fn repondre(s: &mut TcpStream, statut: &str, corps: Option<&Value>, extra: &str) -> std::io::Result<()> {
    let texte = corps.map(|v| v.to_string()).unwrap_or_default();
    let type_ = if corps.is_some() { "Content-Type: application/json\r\n" } else { "" };
    write!(s, "HTTP/1.1 {statut}\r\n{type_}{extra}Content-Length: {}\r\n\r\n{texte}", texte.len())?;
    s.flush()
}

/// Égalité en temps constant, pour ne pas laisser deviner le jeton octet par octet.
fn egal(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn connexion(flux: TcpStream, app: &AppHandle, mcp: &Mcp, jeton: &str) -> std::io::Result<()> {
    flux.set_read_timeout(Some(Duration::from_secs(120)))?;
    let mut sortie = flux.try_clone()?;
    let mut r = BufReader::new(flux);
    while let Some(req) = lire_requete(&mut r)? {
        let hote_ok = req.entetes.get("host").is_some_and(|h| h == &format!("127.0.0.1:{PORT}") || h == &format!("localhost:{PORT}"));
        let origine_ok = req.entetes.get("origin").is_none_or(|o| o == &format!("http://127.0.0.1:{PORT}") || o == &format!("http://localhost:{PORT}"));
        let jeton_ok = req.entetes.get("authorization").and_then(|v| v.strip_prefix("Bearer ")).is_some_and(|t| egal(t.trim(), jeton));
        if !hote_ok || !origine_ok {
            repondre(&mut sortie, "403 Forbidden", None, "")?;
        } else if !jeton_ok {
            repondre(&mut sortie, "401 Unauthorized", None, "WWW-Authenticate: Bearer\r\n")?;
        } else if req.chemin != "/mcp" {
            repondre(&mut sortie, "404 Not Found", None, "")?;
        } else if req.methode != "POST" {
            repondre(&mut sortie, "405 Method Not Allowed", None, "Allow: POST\r\n")?;
        } else {
            match traiter(&req.corps, app, mcp) {
                Some(v) => repondre(&mut sortie, "200 OK", Some(&v), "")?,
                None => repondre(&mut sortie, "202 Accepted", None, "")?,
            }
        }
        if req.entetes.get("connection").is_some_and(|c| c.eq_ignore_ascii_case("close")) {
            break;
        }
    }
    Ok(())
}

fn erreur(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Un message JSON-RPC. None pour une notification (pas de réponse attendue).
fn traiter(corps: &[u8], app: &AppHandle, mcp: &Mcp) -> Option<Value> {
    let Ok(msg) = serde_json::from_slice::<Value>(corps) else {
        return Some(erreur(&Value::Null, -32700, "JSON illisible"));
    };
    let id = msg.get("id").cloned()?;
    let methode = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    let resultat = match methode {
        "initialize" => json!({
            "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or("2025-06-18"),
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": "workshop3d", "title": "Workshop 3D", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Projet ouvert dans Workshop 3D (menuiserie). Cotes en mm. Repère : X largeur, Y profondeur (façade vers -Y), Z hauteur. Commencer par `etat`. Chaque modification est annulable par l'utilisateur (Cmd+Z) ; décrire ce qu'on va changer avant de le faire."
        }),
        "ping" => json!({}),
        "tools/list" | "tools/call" => {
            let n = mcp.suivant.fetch_add(1, Ordering::Relaxed);
            let (tx, rx) = channel();
            mcp.attente.lock().unwrap().insert(n, tx);
            let envoi = json!({ "id": n, "method": methode, "params": params }).to_string();
            let rep = app.emit("mcp", envoi).ok().and_then(|_| rx.recv_timeout(DELAI_INTERFACE).ok());
            mcp.attente.lock().unwrap().remove(&n);
            match rep {
                Some(r) if r.get("error").is_some() => return Some(json!({ "jsonrpc": "2.0", "id": id, "error": r["error"] })),
                Some(r) => r.get("result").cloned().unwrap_or(Value::Null),
                None => return Some(erreur(&id, -32603, "L'interface de Workshop 3D ne répond pas.")),
            }
        }
        _ => return Some(erreur(&id, -32601, "Méthode inconnue")),
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": resultat }))
}
