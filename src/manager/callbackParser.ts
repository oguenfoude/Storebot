// Manager Bot callback data parser
// Parses mgr:* callback patterns into structured objects

export type ManagerCallback =
  | { type: "sellers"; page?: number }
  | { type: "seller_detail"; sellerId: string }
  | { type: "user_list"; sellerId: string; page: number }
  | { type: "user_detail"; userId: string }
  | { type: "product_list"; sellerId: string; page: number }
  | { type: "product_detail"; productId: string }
  | { type: "back_seller"; sellerId: string }
  | { type: "back_users"; sellerId: string }
  | { type: "back_products"; sellerId: string }
  | { type: "pay_seller"; sellerId: string }
  | { type: "seller_back" }
  | { type: "renew"; sellerId: string }
  | { type: "renew_with_days"; sellerId: string; days: number }
  | { type: "edit_product_price"; productId: string }
  | { type: "category_detail"; categoryId: string }
  | { type: "seller_product_detail"; productId: string }
  | { type: "ban"; sellerId: string }
  | { type: "unban"; sellerId: string }
  | { type: "delete_seller"; sellerId: string }
  | { type: "recharge"; userId: string }
  | { type: "confirm_ban"; sellerId: string }
  | { type: "confirm_unban"; sellerId: string }
  | { type: "confirm_delete_seller"; sellerId: string }
  | { type: "confirm_recharge"; userId: string; amount: number }
  | { type: "cancel_action" }
  | { type: "admin_delete_product"; productId: string }
  | { type: "confirm_delete_product"; productId: string }
  | { type: "unknown"; raw: string };

export function parseManagerCallback(data: string): ManagerCallback {
  const parts = data.split(":");

  if (data === "mgr:sellers") {
    return { type: "sellers" };
  }

  if (parts[0] === "mgr" && parts[1] === "sellers" && parts[2]) {
    const page = parseInt(parts[2], 10);
    return { type: "sellers", page: isNaN(page) ? 0 : page };
  }

  if (parts[0] === "mgr" && parts[1] === "seller" && parts[2]) {
    return { type: "seller_detail", sellerId: parts[2] };
  }

  if (parts[0] === "mgr" && parts[1] === "users" && parts[2]) {
    const page = parts[3] ? parseInt(parts[3], 10) : 0;
    return { type: "user_list", sellerId: parts[2], page };
  }

  if (parts[0] === "mgr" && parts[1] === "user" && parts[2]) {
    return { type: "user_detail", userId: parts[2] };
  }

  if (parts[0] === "mgr" && parts[1] === "products" && parts[2]) {
    const page = parts[3] ? parseInt(parts[3], 10) : 0;
    return { type: "product_list", sellerId: parts[2], page };
  }

  if (parts[0] === "mgr" && parts[1] === "product" && parts[2]) {
    return { type: "product_detail", productId: parts[2] };
  }

  if (data.startsWith("mgr:back:seller:")) {
    const sellerId = parts[3];
    return sellerId ? { type: "back_seller", sellerId } : { type: "unknown", raw: data };
  }

  if (data.startsWith("mgr:back:users:")) {
    const sellerId = parts[3];
    return sellerId ? { type: "back_users", sellerId } : { type: "unknown", raw: data };
  }

  if (data.startsWith("mgr:back:products:")) {
    const sellerId = parts[3];
    return sellerId ? { type: "back_products", sellerId } : { type: "unknown", raw: data };
  }

  if (parts[0] === "mgr" && parts[1] === "pay" && parts[2]) {
    return { type: "pay_seller", sellerId: parts[2] };
  }

  if (data === "mgr:seller_back") {
    return { type: "seller_back" };
  }

  if (parts[0] === "mgr" && parts[1] === "renew" && parts[2] && parts[3]) {
    const days = parseInt(parts[3], 10);
    return { type: "renew_with_days", sellerId: parts[2], days };
  }

  if (parts[0] === "mgr" && parts[1] === "renew" && parts[2]) {
    return { type: "renew", sellerId: parts[2] };
  }

  if (parts[0] === "mgr" && parts[1] === "epprod" && parts[2]) {
    return { type: "edit_product_price", productId: parts[2] };
  }

  if (parts[0] === "mgr" && parts[1] === "prod_detail" && parts[2]) {
    return { type: "seller_product_detail", productId: parts[2] };
  }

  if (parts[0] === "mgr" && parts[1] === "cat_detail" && parts[2]) {
    return { type: "category_detail", categoryId: parts[2] };
  }

  if (parts[0] === "mgr" && parts[1] === "ban" && parts[2]) {
    return { type: "ban", sellerId: parts[2] };
  }

  if (parts[0] === "mgr" && parts[1] === "unban" && parts[2]) {
    return { type: "unban", sellerId: parts[2] };
  }

  if (parts[0] === "mgr" && parts[1] === "delete_seller" && parts[2]) {
    return { type: "delete_seller", sellerId: parts[2] };
  }

  if (parts[0] === "mgr" && parts[1] === "recharge" && parts[2]) {
    return { type: "recharge", userId: parts[2] };
  }

  if (parts[0] === "mgr" && parts[1] === "confirm_ban" && parts[2]) {
    return { type: "confirm_ban", sellerId: parts[2] };
  }

  if (parts[0] === "mgr" && parts[1] === "confirm_unban" && parts[2]) {
    return { type: "confirm_unban", sellerId: parts[2] };
  }

  if (parts[0] === "mgr" && parts[1] === "confirm_delete_seller" && parts[2]) {
    return { type: "confirm_delete_seller", sellerId: parts[2] };
  }

  if (parts[0] === "mgr" && parts[1] === "confirm_recharge" && parts[2] && parts[3]) {
    const amount = parseFloat(parts[3]);
    return { type: "confirm_recharge", userId: parts[2], amount };
  }

  if (data === "mgr:cancel_action") {
    return { type: "cancel_action" };
  }

  if (parts[0] === "mgr" && parts[1] === "admin_del_prod" && parts[2]) {
    return { type: "admin_delete_product", productId: parts[2] };
  }

  if (parts[0] === "mgr" && parts[1] === "confirm_del_prod" && parts[2]) {
    return { type: "confirm_delete_product", productId: parts[2] };
  }

  return { type: "unknown", raw: data };
}
