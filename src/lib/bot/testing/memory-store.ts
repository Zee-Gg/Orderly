import { DEMO_GROUPS, DEMO_MENU, type DemoGroupKey } from "@/lib/menu/demo-menu";
import {
  buildBranchMenu,
  priceCartItem,
  type BranchMenuSource,
  type ItemPricingData,
  type PricingGroup,
  type PricingSize,
} from "@/lib/menu/pricing";
import type { AiLogRow, BotSession, BotStore, BranchInfo, CustomerInfo, RecentOrder, RestaurantInfo } from "../types";

/**
 * In-memory BotStore for unit tests: the demo menu with fixed ids, priced by
 * the REAL pricing engine (priceCartItem). Orders are idempotent by key.
 */
export const RESTAURANT_ID = "00000000-0000-4000-8000-0000000000aa";
export const BRANCH_ID = "00000000-0000-4000-8000-0000000000bb";

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function buildMenuData() {
  n = 0;
  const groups = {} as Record<DemoGroupKey, PricingGroup>;
  for (const [key, g] of Object.entries(DEMO_GROUPS) as [DemoGroupKey, (typeof DEMO_GROUPS)[DemoGroupKey]][]) {
    groups[key] = {
      id: uuid(),
      name: g.name,
      nameUr: g.nameUr ?? null,
      minSelect: g.min,
      maxSelect: g.max,
      archived: false,
      sortOrder: 0,
      options: g.options.map(([name, rupees, isDefault], i) => ({
        id: uuid(),
        name,
        nameUr: null,
        priceDelta: rupees * 100,
        isDefault: !!isDefault,
        isAvailable: true,
        archived: false,
        sortOrder: i,
      })),
    };
  }
  const source: BranchMenuSource = { branchId: BRANCH_ID, categories: [], items: [], settings: {}, sizePrices: {} };
  const pricing = new Map<string, ItemPricingData>();
  const itemIds: Record<string, string> = {};
  DEMO_MENU.forEach((cat, ci) => {
    const categoryId = uuid();
    source.categories.push({ id: categoryId, name: cat.name, nameUr: cat.nameUr ?? null, description: null, sortOrder: ci, isActive: true, archived: false });
    cat.items.forEach((it, ii) => {
      const id = uuid();
      itemIds[it.name] = id;
      const sizes: PricingSize[] = (it.sizes ?? []).map(([name, rupees, isDefault], i) => ({
        id: uuid(),
        name,
        nameUr: null,
        price: rupees * 100,
        isDefault: !!isDefault,
        isActive: true,
        archived: false,
        sortOrder: i,
      }));
      const itemGroups = (it.groups ?? []).map((g) => groups[g]);
      const item = {
        id,
        restaurantId: RESTAURANT_ID,
        name: it.name,
        nameUr: it.nameUr ?? null,
        basePrice: it.price !== undefined ? it.price * 100 : null,
        isActive: true,
        archived: false,
        removableOptions: it.removable ?? [],
      };
      const settings = it.outOfStockAtFirstBranch ? { isAvailable: false, isHidden: false, priceOverride: null } : null;
      if (settings) source.settings[id] = settings;
      source.items.push({
        ...item,
        categoryId,
        description: it.description,
        descriptionUr: null,
        imageUrl: null,
        tags: it.tags ?? [],
        aliases: it.aliases,
        prepTimeMinutes: it.prep ?? null,
        sortOrder: ii,
        sizes,
        groups: itemGroups,
      });
      pricing.set(id, {
        item,
        category: { isActive: true, archived: false },
        sizes,
        groups: itemGroups,
        branch: { id: BRANCH_ID, restaurantId: RESTAURANT_ID, isActive: true },
        branchSettings: settings,
        branchSizePrices: {},
      });
    });
  });
  return { source, pricing, itemIds };
}

export type MemoryOrder = {
  id: string;
  orderNumber: number;
  idempotencyKey: string;
  customerId: string;
  total: number;
  deliveryFee: number;
  status: string;
  orderType: string;
  paymentMethod: string;
  riskFlag: string | null;
  lines: { itemId: string; quantity: number; unitPrice: number }[];
  createdAt: string;
};

export function createMemoryBotStore(
  opts: { branch?: Partial<BranchInfo>; restaurant?: Partial<RestaurantInfo>; emptyMenu?: boolean } = {},
) {
  const { source, pricing, itemIds } = buildMenuData();
  const menu = opts.emptyMenu ? { branchId: BRANCH_ID, categories: [] } : buildBranchMenu(source);
  const restaurant: RestaurantInfo = {
    id: RESTAURANT_ID,
    name: "Cheezious",
    phone: "0300-1234567",
    timezone: "Asia/Karachi",
    botEnabled: true,
    highValueCodThreshold: 500000,
    ...opts.restaurant,
  };
  const branch: BranchInfo = {
    id: BRANCH_ID,
    name: "Clifton",
    isOpenNow: true,
    todayHours: "12:00 PM – 11:59 PM",
    address: "Block 5, Clifton",
    area: "Clifton",
    phone: "0300-1234567",
    deliveryFee: 15000,
    minimumOrder: 50000,
    ...opts.branch,
  };
  const customers = new Map<string, CustomerInfo>();
  const sessions = new Map<string, BotSession>();
  const orders: MemoryOrder[] = [];
  const logs: AiLogRow[] = [];
  let seq = 0;
  let orderNumber = 1000;

  const store: BotStore = {
    async getRestaurant(id) {
      return id === RESTAURANT_ID ? restaurant : null;
    },
    async getBranch(rid, bid) {
      return rid === RESTAURANT_ID && bid === BRANCH_ID ? branch : null;
    },
    async getMenu() {
      return menu;
    },
    async priceLine(input) {
      return priceCartItem(pricing.get(input.itemId) ?? null, input);
    },
    async getCustomer(_rid, id) {
      const c = customers.get(id);
      return c ? { ...c } : null;
    },
    async setCustomerName(_rid, id, name) {
      const c = customers.get(id);
      if (c) c.name = name;
    },
    async setCustomerLanguage(_rid, id, language) {
      const c = customers.get(id);
      if (c) c.preferredLanguage = language;
    },
    async getSession(_rid, id) {
      const s = sessions.get(id);
      return s ? structuredClone(s) : null;
    },
    async createSession(input) {
      const now = new Date().toISOString();
      const s: BotSession = {
        id: `00000000-0000-4000-9000-${String(++seq).padStart(12, "0")}`,
        restaurantId: input.restaurantId,
        branchId: input.branchId,
        conversationId: input.conversationId,
        customerId: input.customerId,
        status: "active",
        stage: "collecting_items",
        cart: [],
        orderType: null,
        address: { text: null, area: null, landmark: null, latitude: null, longitude: null },
        paymentMethod: null,
        language: input.language,
        failedAttempts: 0,
        summaryHash: null,
        orderId: null,
        handoffReason: null,
        transcript: [],
        lastActivityAt: now,
        createdAt: now,
      };
      sessions.set(s.id, s);
      return structuredClone(s);
    },
    async saveSession(s) {
      sessions.set(s.id, structuredClone(s));
    },
    async recentOrders(_rid, customerId, limit): Promise<RecentOrder[]> {
      return orders
        .filter((o) => o.customerId === customerId)
        .slice(-limit)
        .reverse()
        .map((o) => ({ orderNumber: o.orderNumber, status: o.status, orderType: o.orderType, total: o.total, createdAt: o.createdAt }));
    },
    async createOrder({ session, customer, deliveryFee, idempotencyKey }) {
      const same = orders.find((o) => o.idempotencyKey === idempotencyKey);
      if (same) return { ok: true, data: { id: same.id, orderNumber: same.orderNumber, duplicate: true } };
      let subtotal = 0;
      const lines: MemoryOrder["lines"] = [];
      for (const l of session.cart) {
        const r = priceCartItem(pricing.get(l.itemId) ?? null, {
          restaurantId: session.restaurantId,
          branchId: session.branchId,
          itemId: l.itemId,
          variantId: l.variantId,
          modifierOptionIds: l.optionIds,
          removals: l.removals,
          quantity: l.quantity,
        });
        if (!r.ok) return { ok: false, code: "PRICING_FAILED", message: "Some items need attention." };
        subtotal += r.line.lineTotal;
        lines.push({ itemId: l.itemId, quantity: l.quantity, unitPrice: r.line.unitPrice });
      }
      const order: MemoryOrder = {
        id: `00000000-0000-4000-a000-${String(orders.length + 1).padStart(12, "0")}`,
        orderNumber: ++orderNumber,
        idempotencyKey,
        customerId: customer.id,
        total: subtotal + deliveryFee,
        deliveryFee,
        status: "awaiting_acceptance",
        orderType: session.orderType ?? "pickup",
        paymentMethod: session.paymentMethod ?? "cod",
        riskFlag: null,
        lines,
        createdAt: new Date().toISOString(),
      };
      orders.push(order);
      const c = customers.get(customer.id);
      if (c) c.totalOrders += 1;
      return { ok: true, data: { id: order.id, orderNumber: order.orderNumber, duplicate: false } };
    },
    async setRiskFlag(_rid, orderId, flag) {
      const o = orders.find((x) => x.id === orderId);
      if (o) o.riskFlag = flag;
    },
    async logTurn(row) {
      logs.push(row);
    },
  };

  function addCustomer(c: Partial<CustomerInfo> = {}): CustomerInfo {
    const customer: CustomerInfo = {
      id: `00000000-0000-4000-b000-${String(customers.size + 1).padStart(12, "0")}`,
      name: null,
      phone: `+9230000000${customers.size + 10}`,
      isBlocked: false,
      totalOrders: 0,
      preferredLanguage: null,
      ...c,
    };
    customers.set(customer.id, customer);
    return customer;
  }

  return { store, restaurant, branch, menu, itemIds, customers, sessions, orders, logs, addCustomer };
}
