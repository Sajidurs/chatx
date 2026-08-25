-- Lets a visitor attach an image to a chat message, which the AI reads via
-- Claude's vision support. Nullable, additive to the existing text content
-- (a message can carry just text, just an image, or both).
alter table chat_messages add column image_url text;

-- Public bucket, same reasoning as assistant-photos: an image a visitor
-- attaches is meant to be shown back to them (and to the business owner
-- reviewing the conversation), and the actual image itself carries no
-- access-control requirement beyond "don't let anyone overwrite it" --
-- writes go through a server route using the service-role client, not a
-- client-facing storage policy.
insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', true)
on conflict (id) do nothing;
