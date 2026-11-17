// Coque native de Workshop 3D : fenêtre, menu, lecture et écriture des fichiers .workshop.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mcp;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

const EXT: &str = "workshop";

/// Demande un fichier à ouvrir. Renvoie (chemin, contenu), ou None si annulé.
#[tauri::command]
async fn open_doc(app: AppHandle, ext: Option<String>, label: Option<String>) -> Result<Option<(String, String)>, String> {
    let ext = ext.unwrap_or_else(|| EXT.into());
    let label = label.unwrap_or_else(|| "Workshop 3D".into());
    // les anciens fichiers .atelier restent ouvrables
    let exts: Vec<&str> = if ext == EXT { vec![EXT, "atelier"] } else { vec![ext.as_str()] };
    let Some(picked) = app.dialog().file().add_filter(&label, &exts).blocking_pick_file() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let text = std::fs::read_to_string(&path).map_err(|e| format!("Lecture impossible : {e}"))?;
    Ok(Some((path.to_string_lossy().into_owned(), text)))
}

/// Enregistre dans `path`, ou demande où si `path` est absent. Renvoie le chemin, ou None si annulé.
#[tauri::command]
async fn save_doc(app: AppHandle, path: Option<String>, contents: String, ext: Option<String>, nom: Option<String>) -> Result<Option<String>, String> {
    let ext = ext.unwrap_or_else(|| EXT.into());
    let nom = nom.unwrap_or_else(|| format!("modele.{ext}"));
    let mut path = match path {
        Some(p) => PathBuf::from(p),
        None => {
            let Some(picked) = app.dialog().file().add_filter(&ext.to_uppercase(), &[ext.as_str()]).set_file_name(&nom).blocking_save_file() else {
                return Ok(None);
            };
            picked.into_path().map_err(|e| e.to_string())?
        }
    };
    if path.extension().and_then(|e| e.to_str()) != Some(ext.as_str()) {
        path.set_extension(&ext);
    }
    // Écriture atomique : un fichier temporaire puis un renommage, pour ne jamais laisser un fichier à moitié écrit.
    let tmp = path.with_extension(format!("{ext}.tmp"));
    std::fs::write(&tmp, contents).map_err(|e| format!("Écriture impossible : {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Écriture impossible : {e}")
    })?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Confirmation avant d'abandonner des modifications non enregistrées.
#[tauri::command]
async fn confirm_discard(app: AppHandle, message: String) -> bool {
    app.dialog()
        .message(message)
        .title("Workshop 3D")
        .buttons(MessageDialogButtons::OkCancelCustom("Continuer sans enregistrer".into(), "Annuler".into()))
        .blocking_show()
}

/// Clé API Anthropic de l'assistant intégré : un fichier lisible par l'utilisateur seul, jamais dans le projet.
fn fichier_cle(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map(|d| d.join("anthropic-key")).map_err(|e| e.to_string())
}

#[tauri::command]
fn cle_api(app: AppHandle) -> Option<String> {
    let t = std::fs::read_to_string(fichier_cle(&app).ok()?).ok()?;
    let t = t.trim();
    (!t.is_empty()).then(|| t.to_string())
}

/// Enregistre la clé (chaîne vide : l'oublie).
#[tauri::command]
fn definir_cle_api(app: AppHandle, cle: String) -> Result<(), String> {
    use std::io::Write;
    let f = fichier_cle(&app)?;
    let cle = cle.trim();
    if cle.is_empty() {
        return match std::fs::remove_file(&f) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        };
    }
    if let Some(d) = f.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut o, 0o600);
    o.open(&f).and_then(|mut h| h.write_all(cle.as_bytes())).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(mcp::Mcp::default()))
        .invoke_handler(tauri::generate_handler![open_doc, save_doc, confirm_discard, cle_api, definir_cle_api, mcp::mcp_reply])
        .setup(|app| {
            let h = app.handle();
            // Serveur MCP local pour un assistant ; l'app fonctionne sans s'il ne peut pas démarrer.
            if let Ok(dossier) = app.path().app_config_dir() {
                mcp::demarrer(h.clone(), &dossier, app.state::<Arc<mcp::Mcp>>().inner().clone());
            }
            let item = |id: &str, label: &str, accel: &str| MenuItemBuilder::with_id(id, label).accelerator(accel).build(h);
            let app_menu = SubmenuBuilder::new(h, "Workshop 3D").about(None).separator().hide().hide_others().show_all().separator().quit().build()?;
            let file = SubmenuBuilder::new(h, "Fichier")
                .item(&item("new", "Nouveau", "CmdOrCtrl+N")?)
                .item(&item("open", "Ouvrir…", "CmdOrCtrl+O")?)
                .separator()
                .item(&item("save", "Enregistrer", "CmdOrCtrl+S")?)
                .item(&item("save_as", "Enregistrer sous…", "CmdOrCtrl+Shift+S")?)
                .separator()
                .item(&item("import_dae", "Importer un modèle Collada (.dae)…", "CmdOrCtrl+I")?)
                .item(&item("export_dae", "Exporter en Collada (.dae) pour SketchUp ou Sweet Home 3D…", "CmdOrCtrl+E")?)
                .build()?;
            // Annuler/Rétablir passent par l'interface, qui choisit entre le modèle et le champ de saisie actif.
            let edit = SubmenuBuilder::new(h, "Édition")
                .item(&item("undo", "Annuler", "CmdOrCtrl+Z")?)
                .item(&item("redo", "Rétablir", "CmdOrCtrl+Shift+Z")?)
                .separator()
                // Couper, copier, coller passent par l'interface : sur une pièce ils agissent sur le modèle, dans un champ sur le texte.
                .item(&item("cut", "Couper", "CmdOrCtrl+X")?)
                .item(&item("copy", "Copier", "CmdOrCtrl+C")?)
                .item(&item("paste", "Coller", "CmdOrCtrl+V")?)
                .item(&item("paste_in_place", "Coller sur place", "CmdOrCtrl+Shift+V")?)
                .item(&item("duplicate", "Dupliquer", "CmdOrCtrl+D")?)
                .separator()
                .item(&item("select_all", "Tout sélectionner", "CmdOrCtrl+A")?)
                .separator()
                // Maj+H et Maj+Option+H sont gérés par l'interface (H seul reste le panoramique).
                .item(&MenuItemBuilder::with_id("hide", "Masquer la sélection (Maj+H)").build(h)?)
                .item(&MenuItemBuilder::with_id("unhide_all", "Tout afficher (Maj+Option+H)").build(h)?)
                .build()?;
            let window = SubmenuBuilder::new(h, "Fenêtre").minimize().fullscreen().separator().close_window().build()?;
            app.set_menu(MenuBuilder::new(h).items(&[&app_menu, &file, &edit, &window]).build()?)?;
            app.on_menu_event(|app, event| {
                let _ = app.emit("menu", event.id().0.clone());
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Workshop 3D");
}
