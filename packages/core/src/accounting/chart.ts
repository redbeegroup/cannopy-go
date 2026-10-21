import { bilingual } from '../i18n/label.js';
import { type Id, newId } from '../ids/id.js';
import type { Account, AccountType, OwnerGroup } from '../schema/account.js';

/**
 * The simplified chart of accounts from the scope doc. The owner only ever
 * sees the owner group and the name; the code and the standard type keep the
 * books correct underneath.
 *
 * System accounts are created for every business and cannot be deleted or
 * renamed, because the posting rules address them by code. Editable accounts
 * are a starter set the owner can rename, hide or add to.
 *
 * Myanmar names are a first draft and need a native speaker's review.
 */

/** Codes the posting rules depend on. Every business has exactly one account per code. */
export const SYSTEM_ACCOUNT_CODES = {
  CASH: '1000',
  RECEIVABLE: '1100',
  STOCK: '1200',
  SUPPLIER_ADVANCE: '1300',
  PAYABLE: '2000',
  CUSTOMER_ADVANCE: '2100',
  TAX_COLLECTED: '2300',
  OWNER_CAPITAL: '3000',
  OWNER_DRAWINGS: '3100',
  RETAINED_PROFIT: '3200',
  OPENING_BALANCE: '3900',
  SALES: '4000',
  DISCOUNTS: '4200',
  COST_OF_GOODS_SOLD: '5000',
  PURCHASES: '5010',
  STOCK_ADJUSTMENT: '5020',
  PAYMENT_FEES: '6080',
  OTHER_EXPENSE: '6900',
} as const;

export type SystemAccountCode = (typeof SYSTEM_ACCOUNT_CODES)[keyof typeof SYSTEM_ACCOUNT_CODES];

export interface StandardAccount {
  code: string;
  type: AccountType;
  ownerGroup: OwnerGroup;
  nameEn: string;
  nameMy: string;
  isSystem: boolean;
  isHidden: boolean;
  moneyKind: 'cash' | 'bank' | 'wallet' | null;
}

const a = (
  code: string,
  type: AccountType,
  ownerGroup: OwnerGroup,
  nameEn: string,
  nameMy: string,
  opts: Partial<Pick<StandardAccount, 'isSystem' | 'isHidden' | 'moneyKind'>> = {},
): StandardAccount => ({
  code,
  type,
  ownerGroup,
  nameEn,
  nameMy,
  isSystem: opts.isSystem ?? false,
  isHidden: opts.isHidden ?? false,
  moneyKind: opts.moneyKind ?? null,
});

const sys = { isSystem: true } as const;

/**
 * The full starter chart. Order is the display order within each group.
 * 6080 Bank and payment fees is a system account here although the scope doc
 * lists it as editable, because transfers and wallet cash-outs post fees to it
 * by code. It stays renameable in spirit (only deletion is blocked).
 */
export const STANDARD_CHART: readonly StandardAccount[] = [
  a('1000', 'asset', 'my_money', 'Cash in hand', 'လက်ထဲငွေသား', { ...sys, moneyKind: 'cash' }),
  a('1010', 'asset', 'my_money', 'Bank account', 'ဘဏ်ငွေစာရင်း', { moneyKind: 'bank' }),
  a('1020', 'asset', 'my_money', 'Mobile wallet', 'မိုဘိုင်းငွေအိတ်', { moneyKind: 'wallet' }),
  a('1100', 'asset', 'owed_to_me', 'Customers owe me', 'ဖောက်သည်များမှ ရရန်ရှိငွေ', sys),
  a('1200', 'asset', 'stock', 'Stock on hand', 'ကုန်ပစ္စည်းလက်ကျန်', sys),
  a('1300', 'asset', 'owed_to_me', 'Advances I paid to suppliers', 'ပေးသွင်းသူသို့ ကြိုတင်ပေးငွေ', sys),
  a('1500', 'asset', 'things_i_own', 'Equipment and tools', 'လုပ်ငန်းသုံးပစ္စည်းကိရိယာ'),
  a('2000', 'liability', 'i_owe', 'Suppliers I owe', 'ပေးသွင်းသူများသို့ ပေးရန်ရှိငွေ', sys),
  a('2100', 'liability', 'i_owe', 'Advances customers paid me', 'ဖောက်သည်ကြိုတင်ငွေ', sys),
  a('2200', 'liability', 'i_owe', 'Loans', 'ချေးငွေ'),
  a('2300', 'liability', 'i_owe', 'Tax collected on sales', 'အရောင်းခွန် ကောက်ခံထားငွေ', {
    ...sys,
    isHidden: true,
  }),
  a('3000', 'equity', 'owner', 'Owner capital (money I put in)', 'ပိုင်ရှင်ထည့်ဝင်ငွေ', sys),
  a('3100', 'equity', 'owner', 'Owner drawings (money I took out)', 'ပိုင်ရှင်ထုတ်ယူငွေ', sys),
  a('3200', 'equity', 'owner', 'Profit kept in the business', 'လုပ်ငန်းထဲထားသောအမြတ်', sys),
  a('3900', 'equity', 'owner', 'Opening balance adjustment', 'အစလက်ကျန်ချိန်ညှိမှု', {
    ...sys,
    isHidden: true,
  }),
  a('4000', 'income', 'money_in', 'Sales', 'ရောင်းရငွေ', sys),
  a('4100', 'income', 'money_in', 'Service income', 'ဝန်ဆောင်မှုဝင်ငွေ'),
  a('4200', 'income', 'money_in', 'Discounts given', 'လျှော့ပေးငွေ', sys),
  a('4900', 'income', 'money_in', 'Other income', 'အခြားဝင်ငွေ'),
  a('5000', 'cost_of_sales', 'money_out', 'Cost of goods sold', 'ရောင်းကုန်ကုန်ကျစရိတ်', sys),
  a('5010', 'cost_of_sales', 'money_out', 'Purchases (items not tracked as stock)', 'ကုန်ဝယ်စရိတ်', sys),
  a('5020', 'cost_of_sales', 'money_out', 'Stock loss or gain', 'ကုန်ပစ္စည်း အရှုံးအမြတ်', sys),
  a('6000', 'expense', 'money_out', 'Rent', 'ဆိုင်ခန်းငှားခ'),
  a('6010', 'expense', 'money_out', 'Wages and salaries', 'လုပ်ခလစာ'),
  a('6020', 'expense', 'money_out', 'Electricity and water', 'မီးဖိုး ရေဖိုး'),
  a('6030', 'expense', 'money_out', 'Phone and internet', 'ဖုန်းနှင့် အင်တာနက်'),
  a('6040', 'expense', 'money_out', 'Transport and delivery', 'သယ်ယူပို့ဆောင်ခ'),
  a('6050', 'expense', 'money_out', 'Packaging and supplies', 'ထုပ်ပိုးနှင့် လုပ်ငန်းသုံးပစ္စည်း'),
  a('6060', 'expense', 'money_out', 'Repairs and maintenance', 'ပြင်ဆင်ထိန်းသိမ်းစရိတ်'),
  a('6070', 'expense', 'money_out', 'Advertising and marketing', 'ကြော်ငြာစရိတ်'),
  a('6080', 'expense', 'money_out', 'Bank and payment fees', 'ဘဏ်နှင့် ငွေလွှဲအခကြေးငွေ', sys),
  a('6090', 'expense', 'money_out', 'Taxes and licences', 'အခွန်နှင့် လိုင်စင်ကြေး'),
  a('6100', 'expense', 'money_out', 'Meals and entertaining', 'ဧည့်ခံစရိတ်'),
  a('6110', 'expense', 'money_out', 'Interest paid', 'အတိုးစရိတ်'),
  a('6900', 'expense', 'money_out', 'Other expenses', 'အခြားစရိတ်', sys),
];

/** Which owner group an owner-created account lands in, by standard type. */
export const OWNER_GROUP_FOR_TYPE: Record<AccountType, OwnerGroup> = {
  asset: 'things_i_own',
  liability: 'i_owe',
  equity: 'owner',
  income: 'money_in',
  cost_of_sales: 'money_out',
  expense: 'money_out',
};

/** The standard type an owner-created account gets, from the group the owner picked. */
export const TYPE_FOR_OWNER_GROUP: Record<OwnerGroup, AccountType> = {
  my_money: 'asset',
  owed_to_me: 'asset',
  stock: 'asset',
  things_i_own: 'asset',
  i_owe: 'liability',
  owner: 'equity',
  money_in: 'income',
  money_out: 'expense',
};

/** Debit-normal account types: a debit increases the balance. */
export function isDebitNormal(type: AccountType): boolean {
  return type === 'asset' || type === 'cost_of_sales' || type === 'expense';
}

/**
 * Builds the account rows for a new business. Ids are UUID v7 made here so the
 * caller (device or server) owns them from the start.
 */
export function standardChart(businessId: Id, now: string): Account[] {
  return STANDARD_CHART.map((s) => ({
    id: newId(),
    businessId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    code: s.code,
    type: s.type,
    ownerGroup: s.ownerGroup,
    name: bilingual(s.nameEn, s.nameMy),
    isSystem: s.isSystem,
    isHidden: s.isHidden,
    moneyKind: s.moneyKind,
    provider: null,
    defaultFee: null,
  }));
}

/**
 * Next free code for an owner-created account in a group: the group's code
 * range, walking up in steps of 10 past the codes already in use.
 */
export function nextAccountCode(group: OwnerGroup, existingCodes: Iterable<string>): string {
  const used = new Set(existingCodes);
  const ranges: Record<OwnerGroup, [number, number]> = {
    my_money: [1010, 1099],
    owed_to_me: [1310, 1399],
    stock: [1210, 1299],
    things_i_own: [1510, 1999],
    i_owe: [2210, 2999],
    owner: [3300, 3899],
    money_in: [4110, 4999],
    money_out: [6120, 6999],
  };
  const [from, to] = ranges[group];
  for (let code = from; code <= to; code += 10) {
    const s = String(code);
    if (!used.has(s)) return s;
  }
  for (let code = from; code <= to; code += 1) {
    const s = String(code);
    if (!used.has(s)) return s;
  }
  throw new Error(`No free account code left in group ${group}`);
}
