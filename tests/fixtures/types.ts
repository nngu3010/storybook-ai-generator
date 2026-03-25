// Shared types used by components — for testing get_type_definition

export interface Product {
  /** Unique product identifier */
  id: string;
  /** Display name of the product */
  name: string;
  /** Price in dollars */
  price: number;
  /** Product category */
  category: ProductCategory;
  /** Tags for search */
  tags: string[];
  /** Optional metadata */
  metadata?: ProductMetadata;
}

export interface ProductMetadata {
  sku: string;
  weight: number;
  dimensions: Dimensions;
}

export interface Dimensions {
  width: number;
  height: number;
  depth: number;
}

export type ProductCategory = 'food' | 'drink' | 'snack' | 'household';

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Cart {
  /** Unique cart ID */
  id: string;
  /** Items in the cart */
  items: CartItem[];
  /** Cart totals summary */
  summary: CartSummary;
}

export interface CartSummary {
  subtotal: number;
  tax: number;
  total: number;
  itemCount: number;
}

export enum OrderStatus {
  Pending = 'pending',
  Processing = 'processing',
  Shipped = 'shipped',
  Delivered = 'delivered',
}
