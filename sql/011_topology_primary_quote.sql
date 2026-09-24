-- A candidate's primary source can retain a short verbatim passage separately
-- from its reviewer-written evidence summary.
ALTER TABLE topology_candidates ADD COLUMN exact_quote text;
