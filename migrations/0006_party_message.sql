-- The leader's "想對新人說的話" was previously only forwarded to the Sheet.
-- Store it on the party too so the leader's RSVP can be pre-filled when they
-- come back to edit (otherwise a re-submit would blank it).
ALTER TABLE party ADD COLUMN message TEXT;
