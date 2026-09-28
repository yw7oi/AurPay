/* In-memory row types for the UrPay store — port of app/models.py.
 * All datetimes are stored internally as epoch milliseconds (UTC) and
 * serialized as naive ISO strings ("2026-09-27T12:34:56") at the API edge. */

export type UserRow = {
  id: number;
  first_name: string;
  father_name: string;
  family_name: string;
  full_name: string;
  gender: string;
  age: number;
  city: string;
  district: string;
  phone: string;
  email: string;
  card_number: string;
  pin_salt: string;
  pin_hash: string;
  balance: number;
  avatar_hue: number;
  is_demo: boolean;
  created_at: number;
  /* login lockout: wrong-PIN attempt tracking + escalating temporary bans */
  failed_attempts: number;
  ban_count: number;
  locked_until: number | null;
};

export type BillRow = {
  id: number;
  user_id: number;
  category: string;
  biller_code: string;
  biller_name: string;
  subscriber_no: string;
  amount: number;
  period: string;
  due_date: number;
  status: string; // unpaid | paid
  issued_at: number;
  paid_at: number | null;
  receipt_ref: string | null;
};

export type TxnRow = {
  id: number;
  /** shared between the two sides of a transfer (out/in) */
  reference: string;
  user_id: number;
  type: string; // bill_payment | transfer_out | transfer_in | topup | goal_deposit | goal_withdraw
  direction: string; // out | in
  amount: number;
  balance_after: number;
  title: string;
  subtitle: string;
  category: string;
  counterparty_id: number | null;
  bill_id: number | null;
  created_at: number;
};

export type TransferRequestRow = {
  id: number;
  sender_id: number;
  receiver_id: number;
  amount: number;
  status: string; // pending | confirmed | cancelled | declined | expired
  created_at: number;
  confirmed_at: number | null;
};

export type AgentMessageRow = {
  id: number;
  user_id: number;
  role: string; // user | assistant
  content: string;
  provider: string;
  created_at: number;
};

export type BudgetRow = {
  id: number;
  user_id: number;
  category: string;
  monthly_limit: number;
  created_at: number;
  updated_at: number | null;
};

export type NotificationRow = {
  id: number;
  user_id: number;
  kind: string;
  title: string;
  body: string;
  amount: number | null;
  reference: string;
  is_read: boolean;
  created_at: number;
};

export type ScheduledRow = {
  id: number;
  user_id: number;
  kind: string; // bill | transfer
  /* bill mandate fields */
  category: string;
  biller_code: string;
  biller_name: string;
  subscriber_no: string;
  /* transfer mandate fields */
  receiver_card: string;
  receiver_name: string;
  amount: number;
  frequency: string; // once | monthly
  next_run_at: number;
  last_run_at: number | null;
  status: string; // pending | paused | executed | cancelled | failed
  created_at: number;
};

export type SavingsGoalRow = {
  id: number;
  user_id: number;
  name: string;
  emoji: string;
  target_amount: number;
  saved_amount: number;
  status: string; // active | completed
  created_at: number;
  updated_at: number | null;
};

export type FavoriteRow = {
  id: number;
  user_id: number;
  target_user_id: number;
  created_at: number;
};

export type Db = {
  users: UserRow[];
  bills: BillRow[];
  txns: TxnRow[];
  transferRequests: TransferRequestRow[];
  agentMessages: AgentMessageRow[];
  budgets: BudgetRow[];
  notifications: NotificationRow[];
  scheduled: ScheduledRow[];
  goals: SavingsGoalRow[];
  favorites: FavoriteRow[];
  seq: {
    users: number;
    bills: number;
    txns: number;
    transferRequests: number;
    agentMessages: number;
    budgets: number;
    notifications: number;
    scheduled: number;
    goals: number;
    favorites: number;
  };
};
