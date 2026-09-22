import type { TicketStatus } from "@shared/session-constants";

export const TICKET_STATUS_LABEL_KEY: Record<TicketStatus, string> = {
  ready: "output.ticketStatusReady",
  "in-progress": "output.ticketStatusInProgress",
  done: "output.ticketStatusDone",
};
