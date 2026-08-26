import {
  Globe, Landmark, MapPin, Map, Home, Building2, GitBranch, Layers, DoorOpen, Boxes,
  Search, Plus, Pencil, Trash2, Archive, ArchiveRestore, Copy, ChevronRight, ChevronDown,
  X, Upload, Download, Users, User, Mail, Phone, ExternalLink, ArrowLeft, Command, CornerDownLeft,
  Network, MoreHorizontal, Check, Hash, Building, FileSpreadsheet, Sparkles, MoveRight,
  Maximize, ChevronsDown, ChevronsUp, Eye, EyeOff, Keyboard, Camera, IdCard, UserPlus, Calendar,
  MessageCircle, PhoneCall, Clock, FileText, StickyNote, TrendingUp, ArrowLeftRight, Star,
  GripVertical, BarChart3, PieChart, UserX, UserCheck, Briefcase, Handshake, CalendarClock,
  Circle, CircleDot, Link2, Send, Flag, ArrowUp, ArrowDown, Type, Menu, List, SlidersHorizontal,
  RotateCcw, Loader2, GitMerge, Calculator, Lock, Unlock, Printer, Settings, TriangleAlert, Database,
  type LucideIcon,
} from 'lucide-react'

const REGISTRY: Record<string, LucideIcon> = {
  Globe, Landmark, MapPin, Map, Home, Building2, GitBranch, Layers, DoorOpen, Boxes,
  Search, Plus, Pencil, Trash2, Archive, ArchiveRestore, Copy, ChevronRight, ChevronDown,
  X, Upload, Download, Users, User, Mail, Phone, ExternalLink, ArrowLeft, Command, CornerDownLeft,
  Network, MoreHorizontal, Check, Hash, Building, FileSpreadsheet, Sparkles, MoveRight,
  Maximize, ChevronsDown, ChevronsUp, Eye, EyeOff, Keyboard, Camera, IdCard, UserPlus, Calendar,
  MessageCircle, PhoneCall, Clock, FileText, StickyNote, TrendingUp, ArrowLeftRight, Star,
  GripVertical, BarChart3, PieChart, UserX, UserCheck, Briefcase, Handshake, CalendarClock,
  Circle, CircleDot, Link2, Send, Flag, ArrowUp, ArrowDown, Type, Menu, List, SlidersHorizontal,
  RotateCcw, Loader: Loader2, GitMerge, Calculator, Lock, Unlock, Printer, Settings, TriangleAlert, Database,
}

export function Icon({ name, className, size = 16 }: { name: string; className?: string; size?: number }) {
  const Cmp = REGISTRY[name] ?? Hash
  return <Cmp className={className} size={size} strokeWidth={1.9} aria-hidden />
}
