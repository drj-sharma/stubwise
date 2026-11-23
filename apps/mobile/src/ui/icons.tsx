import type { Icon as PhosphorIcon, IconWeight } from 'phosphor-react-native';
import { ArrowClockwiseIcon } from 'phosphor-react-native/src/icons/ArrowClockwise';
import { ArrowLeftIcon } from 'phosphor-react-native/src/icons/ArrowLeft';
import { ArrowRightIcon } from 'phosphor-react-native/src/icons/ArrowRight';
import { BankIcon } from 'phosphor-react-native/src/icons/Bank';
import { CalendarBlankIcon } from 'phosphor-react-native/src/icons/CalendarBlank';
import { CaretDownIcon } from 'phosphor-react-native/src/icons/CaretDown';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { CaretUpIcon } from 'phosphor-react-native/src/icons/CaretUp';
import { ChartBarIcon } from 'phosphor-react-native/src/icons/ChartBar';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { CircleHalfIcon } from 'phosphor-react-native/src/icons/CircleHalf';
import { ClockCounterClockwiseIcon } from 'phosphor-react-native/src/icons/ClockCounterClockwise';
import { DeviceMobileIcon } from 'phosphor-react-native/src/icons/DeviceMobile';
import { EnvelopeSimpleIcon } from 'phosphor-react-native/src/icons/EnvelopeSimple';
import { ExportIcon } from 'phosphor-react-native/src/icons/Export';
import { EyeIcon } from 'phosphor-react-native/src/icons/Eye';
import { EyeSlashIcon } from 'phosphor-react-native/src/icons/EyeSlash';
import { FileMagnifyingGlassIcon } from 'phosphor-react-native/src/icons/FileMagnifyingGlass';
import { FileTextIcon } from 'phosphor-react-native/src/icons/FileText';
import { GoogleLogoIcon } from 'phosphor-react-native/src/icons/GoogleLogo';
import { HandPalmIcon } from 'phosphor-react-native/src/icons/HandPalm';
import { ImageIcon } from 'phosphor-react-native/src/icons/Image';
import { ListBulletsIcon } from 'phosphor-react-native/src/icons/ListBullets';
import { LockIcon } from 'phosphor-react-native/src/icons/Lock';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { MapPinIcon } from 'phosphor-react-native/src/icons/MapPin';
import { MapTrifoldIcon } from 'phosphor-react-native/src/icons/MapTrifold';
import { MoneyIcon } from 'phosphor-react-native/src/icons/Money';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { PrinterIcon } from 'phosphor-react-native/src/icons/Printer';
import { ReceiptIcon } from 'phosphor-react-native/src/icons/Receipt';
import { SlidersHorizontalIcon } from 'phosphor-react-native/src/icons/SlidersHorizontal';
import { StackIcon } from 'phosphor-react-native/src/icons/Stack';
import { StorefrontIcon } from 'phosphor-react-native/src/icons/Storefront';
import { TableIcon } from 'phosphor-react-native/src/icons/Table';
import { TrashIcon } from 'phosphor-react-native/src/icons/Trash';
import { UserIcon } from 'phosphor-react-native/src/icons/User';
import { UserCircleCheckIcon } from 'phosphor-react-native/src/icons/UserCircleCheck';
import { UserPlusIcon } from 'phosphor-react-native/src/icons/UserPlus';
import { UsersIcon } from 'phosphor-react-native/src/icons/Users';
import { WarningIcon } from 'phosphor-react-native/src/icons/Warning';
import { WifiSlashIcon } from 'phosphor-react-native/src/icons/WifiSlash';
import { XIcon } from 'phosphor-react-native/src/icons/X';

/**
 * The app's icons: Phosphor (phosphor-icons.com), drawn as SVG so they look
 * the same on iPhone, iPad and Android. Each is imported on its own so the
 * bundle carries only these. Keys are the names the screens use; a key ending
 * in `.fill` draws the solid weight.
 */
export const ICONS = {
  'arrow.clockwise': ArrowClockwiseIcon,
  'arrow.left': ArrowLeftIcon,
  'arrow.right': ArrowRightIcon,
  'building.2': StorefrontIcon,
  'building.2.fill': StorefrontIcon,
  'building.columns': BankIcon,
  'building.columns.fill': BankIcon,
  'chart.bar': ChartBarIcon,
  calendar: CalendarBlankIcon,
  checkmark: CheckIcon,
  'checkmark.circle.fill': CheckCircleIcon,
  'chevron.down': CaretDownIcon,
  'chevron.right': CaretRightIcon,
  'chevron.up': CaretUpIcon,
  'circle.lefthalf.filled': CircleHalfIcon,
  'clock.arrow.circlepath': ClockCounterClockwiseIcon,
  'doc.text': FileTextIcon,
  'doc.text.fill': FileTextIcon,
  'doc.text.magnifyingglass': FileMagnifyingGlassIcon,
  'exclamationmark.triangle.fill': WarningIcon,
  envelope: EnvelopeSimpleIcon,
  eye: EyeIcon,
  'eye.slash.fill': EyeSlashIcon,
  'g.circle.fill': GoogleLogoIcon,
  'hand.raised.fill': HandPalmIcon,
  iphone: DeviceMobileIcon,
  'list.bullet.rectangle': ListBulletsIcon,
  'lock.fill': LockIcon,
  magnifyingglass: MagnifyingGlassIcon,
  map: MapTrifoldIcon,
  'mappin.and.ellipse': MapPinIcon,
  'person.2': UsersIcon,
  'person.2.fill': UsersIcon,
  'person.badge.plus': UserPlusIcon,
  'person.crop.circle.badge.checkmark': UserCircleCheckIcon,
  'person.fill': UserIcon,
  photo: ImageIcon,
  'photo.fill': ImageIcon,
  plus: PlusIcon,
  printer: PrinterIcon,
  receipt: ReceiptIcon,
  banknote: MoneyIcon,
  'slider.horizontal.3': SlidersHorizontalIcon,
  'square.and.arrow.up': ExportIcon,
  'square.stack.3d.up': StackIcon,
  tablecells: TableIcon,
  trash: TrashIcon,
  'wifi.exclamationmark': WifiSlashIcon,
  xmark: XIcon,
} satisfies Record<string, PhosphorIcon>;

export type IconName = keyof typeof ICONS;

export function iconWeight(name: IconName): IconWeight {
  return name.endsWith('.fill') ? 'fill' : 'regular';
}
