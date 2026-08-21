export type AppView =
  | 'landing'
  | 'scanner'
  | 'usecases'
  | 'productpass'
  | 'co2'
  | 'origin'
  | 'deconstruction'
  | 'documentation'
  | 'liability'
  | 'chat';

export interface Dimensions {
  length: number;
  width: number;
  thickness: number;
  unit: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Origin {
  forestryOffice?: string;
  district?: string;
  location?: string;
  region: string;
  country: string;
  harvestDate?: string;
  coordinates: Coordinates;
}

export type ProductType = 'finished' | 'raw_material';

export interface Product {
  id: string;
  name: string;
  description?: string;
  woodType: string;
  woodTypeScientific?: string;
  quality?: string;
  dimensions?: Dimensions;
  origin?: Origin;
  harvestDate?: string;
  certifications?: string[];
  productType?: ProductType;
}

export interface SupplyChainStep {
  id: number;
  stage: 'forest' | 'transport' | 'sawmill' | 'manufacturer' | 'construction';
  company: string;
  date: string;
  location: string;
  description: string;
  details: {
    label: string;
    value: string;
  }[];
  icon: string;
}

export interface ProductPassData {
  product: Product;
  supplyChain: SupplyChainStep[];
}
