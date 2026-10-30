export type TicketActor = {
  type: string;
  id: string;
  name?: string | null;
  email?: string | null;
};

export type TicketMessage = {
  ticket_id: string;
  direction: "inbound" | "outbound";
  timestamp: string;
  from_address: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
};

export type FreshserviceTicket = {
  id: string;
  subject: string;
  description: string;
  created_at: string;
  requester: TicketActor;
  status: string;
  priority: string;
  classification: string | null;
  category: string;
  subcategory: string;
  platform: string | null;
  assigned_group_id: string;
  incident: {
    timestamp: string | null;
    reported_timezone: string | null;
    customer_id: string | null;
    member_id: string | null;
    customer_email: string | null;
    customer_name: string | null;
  };
  tags: string[];
  private_notes: Array<{ timestamp: string; author: TicketActor; body: string }>;
  conversation: TicketMessage[];
  resolution: {
    summary: string;
    resolved_by: TicketActor;
    resolved_at: string;
    confirmed_at: string | null;
    closed_at: string | null;
    confirmation_outcome: "resolved" | "timeout";
  } | null;
};

export type FreshserviceArticle = {
  id: string;
  title: string;
  status: string;
  body: string;
  tags: string[];
  platforms: string[];
  process_ids: string[];
  owner_group_id: string;
  version: number;
  updated_at: string | null;
};

export type ConfluenceDocument = {
  id: string;
  title: string;
  status: "published" | "draft";
  version: number;
  created_at: string | null;
  updated_at: string | null;
  author: string | null;
  body: string;
  kind: "dependency_map" | "access_layer" | "knowledge_base";
};

export type RuntimeData = {
  tickets: FreshserviceTicket[];
  freshservice_kb: FreshserviceArticle[];
  confluence_documents: ConfluenceDocument[];
};
