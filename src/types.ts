import { Context, SessionFlavor } from "grammy";

export interface SessionData {
  awaitingPreOrderMessage?: boolean;
  preOrderProductId?: string | null;
  awaitingFullName?: boolean;
  awaitingPhoneNumber?: boolean;
  awaitingBuyConfirmationProductId?: string | null;
}

export type MyContext = Context & SessionFlavor<SessionData>;

