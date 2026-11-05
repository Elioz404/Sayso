// What a product field is called for screen readers, with the context the owner sees around it: the
// product's own name and the option's, never a bare "Name" repeated down the page or "Price of Default".
import { variantTitle } from '@/core/catalog.ts';

/** "Mug" or "Mug, Sage". */
export function optionOf(productName: string, title: string): string {
  const own = variantTitle(title);
  const product = productName.trim() || 'this product';
  return own ? `${product}, ${own}` : product;
}

export const fieldNames = {
  name: (n?: number) => (n === undefined ? 'Product name' : `Name of product ${n}`),
  description: (productName: string) => `Description of ${productName.trim() || 'this product'}`,
  option: (productName: string) => `Option name, ${productName.trim() || 'this product'}`,
  price: (productName: string, title: string) => `Price, ${optionOf(productName, title)}`,
  stock: (productName: string, title: string) => `Stock, ${optionOf(productName, title)}`,
  shippingPrice: (method: string) => `${method}: shipping price`,
  freeAbove: (method: string) => `${method}: free shipping above`,
};
