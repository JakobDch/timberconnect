import type { UseCase } from '../types';

/**
 * Use Case Konfiguration für die UI
 * Diese Daten definieren die verfügbaren Use Cases in der Anwendung.
 */
export const useCases: UseCase[] = [
  {
    id: 'dbpp',
    title: 'DBPP (Digitaler Bau Produktpass)',
    description: 'Zusammenfassung vom Bauteil',
    icon: 'file-text',
    active: true,
  },
  {
    id: 'origin-proof',
    title: 'Herkunftsnachweis',
    description: 'Flurstück in Karte wo das Holz herkommt',
    icon: 'map-pin',
    active: false,
  },
  {
    id: 'pefc-fsc',
    title: 'PEFC/FSC Zertifizierung',
    description: 'Nachhaltigkeitszertifikate und Nachweise',
    icon: 'award',
    active: false,
  },
  {
    id: 'dgnb',
    title: 'DGNB Zertifizierung',
    description: 'Merkmale und Infos zur BSP Platte',
    icon: 'badge-check',
    active: false,
  },
  {
    id: 'maintenance',
    title: 'Wartungsmanagement',
    description: 'Handlungsempfehlungen bei Schäden (z.B. Wasserschaden)',
    icon: 'wrench',
    active: false,
  },
  {
    id: 'deconstruction',
    title: 'Rückbaubarkeit',
    description: 'Verbindungsarten, Wiederverwendbarkeit, Kontakt zu DERIX',
    icon: 'hammer',
    active: false,
  },
  {
    id: 'chatbot',
    title: 'ChatBot',
    description: 'Sprich mit deinem Bauteil',
    icon: 'message-circle',
    active: false,
  },
];
