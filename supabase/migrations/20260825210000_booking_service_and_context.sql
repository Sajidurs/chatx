-- Founder feedback: the Bookings tab showed who booked and when, but not
-- what for, or any context about the customer -- both captured by the AI
-- right at booking time (it already has the full conversation in view),
-- not backfilled or summarized separately afterward.
alter table bookings add column service text;
alter table bookings add column customer_notes text;
