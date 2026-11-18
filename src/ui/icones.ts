// Icônes de l'interface : Tabler Icons (MIT, https://tabler.io/icons), importées en texte SVG par Vite et compilées dans le paquet.
// `ico('plus')` rend le SVG ; sa taille et sa couleur viennent du CSS (`svg.ico`, currentColor).
import pencil from '@tabler/icons/outline/pencil.svg?raw';
import sparkles from '@tabler/icons/outline/sparkles.svg?raw';
import pointer from '@tabler/icons/outline/pointer.svg?raw';
import arrowsHorizontal from '@tabler/icons/outline/arrows-horizontal.svg?raw';
import arrowsMaximize from '@tabler/icons/outline/arrows-maximize.svg?raw';
import door from '@tabler/icons/outline/door.svg?raw';
import arrowsMove from '@tabler/icons/outline/arrows-move.svg?raw';
import rotateClockwise from '@tabler/icons/outline/rotate-clockwise.svg?raw';
import rulerMeasure from '@tabler/icons/outline/ruler-measure.svg?raw';
import handStop from '@tabler/icons/outline/hand-stop.svg?raw';
import plus from '@tabler/icons/outline/plus.svg?raw';
import palette from '@tabler/icons/outline/palette.svg?raw';
import shieldCheck from '@tabler/icons/outline/shield-check.svg?raw';
import angle from '@tabler/icons/outline/angle.svg?raw';
import fileSpreadsheet from '@tabler/icons/outline/file-spreadsheet.svg?raw';
import scissors from '@tabler/icons/outline/scissors.svg?raw';
import printer from '@tabler/icons/outline/printer.svg?raw';
import circleDot from '@tabler/icons/outline/circle-dot.svg?raw';
import shoppingCart from '@tabler/icons/outline/shopping-cart.svg?raw';
import listNumbers from '@tabler/icons/outline/list-numbers.svg?raw';
import folderOpen from '@tabler/icons/outline/folder-open.svg?raw';
import deviceFloppy from '@tabler/icons/outline/device-floppy.svg?raw';
import dots from '@tabler/icons/outline/dots.svg?raw';
import tag from '@tabler/icons/outline/tag.svg?raw';
import ruler2 from '@tabler/icons/outline/ruler-2.svg?raw';
import arrowsDiagonal from '@tabler/icons/outline/arrows-diagonal.svg?raw';
import eye from '@tabler/icons/outline/eye.svg?raw';
import line from '@tabler/icons/outline/line.svg?raw';
import rectangle from '@tabler/icons/outline/rectangle.svg?raw';
import circle from '@tabler/icons/outline/circle.svg?raw';
import arrowsVertical from '@tabler/icons/outline/arrows-vertical.svg?raw';
import eraser from '@tabler/icons/outline/eraser.svg?raw';
import rotate3d from '@tabler/icons/outline/rotate-3d.svg?raw';
import helpCircle from '@tabler/icons/outline/help-circle.svg?raw';
import hammer from '@tabler/icons/outline/hammer.svg?raw';
import filePlus from '@tabler/icons/outline/file-plus.svg?raw';
import download from '@tabler/icons/outline/download.svg?raw';
import upload from '@tabler/icons/outline/upload.svg?raw';
import x from '@tabler/icons/outline/x.svg?raw';

const ICONES = {
  'sparkles': sparkles,
  'pencil': pencil,
  'pointer': pointer,
  'arrows-horizontal': arrowsHorizontal,
  'arrows-maximize': arrowsMaximize,
  'door': door,
  'arrows-move': arrowsMove,
  'rotate-clockwise': rotateClockwise,
  'ruler-measure': rulerMeasure,
  'hand-stop': handStop,
  'plus': plus,
  'palette': palette,
  'shield-check': shieldCheck,
  'angle': angle,
  'file-spreadsheet': fileSpreadsheet,
  'scissors': scissors,
  'printer': printer,
  'circle-dot': circleDot,
  'shopping-cart': shoppingCart,
  'list-numbers': listNumbers,
  'folder-open': folderOpen,
  'device-floppy': deviceFloppy,
  'dots': dots,
  'tag': tag,
  'ruler-2': ruler2,
  'arrows-diagonal': arrowsDiagonal,
  'eye': eye,
  'line': line,
  'rectangle': rectangle,
  'circle': circle,
  'arrows-vertical': arrowsVertical,
  'eraser': eraser,
  'rotate-3d': rotate3d,
  'help-circle': helpCircle,
  'hammer': hammer,
  'file-plus': filePlus,
  'download': download,
  'upload': upload,
  'x': x,
} as const;
export type Icone = keyof typeof ICONES;
export const ico = (n: Icone): string => ICONES[n].replace(/class="[^"]*"/, 'class="ico" aria-hidden="true"').replace(/<path stroke="none"[^>]*\/>/, '');
