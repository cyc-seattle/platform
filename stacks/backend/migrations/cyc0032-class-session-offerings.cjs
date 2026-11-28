// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// An offering is one Clubspot class in one session (cyc-seattle/platform#395). The CRM's sync made one
// offering for a whole class when Clubspot capped the class across its sessions, and those rows stayed.
// Each such offering becomes one for each session its class is offered in, or a registration names:
// the same product, form and price, with the session's name, dates and cap (the larger of two), and the offering's
// schedule. Each registration moves to its entry's session's offering, and each activity to the one
// whose dates hold it. The whole-class offering, then empty, goes. One whose class has no session left
// in Clubspot, and nothing pointing at it, just goes. A check then keeps an offering's class and
// session linked together, or neither.
//
// It's one statement, so Postgres runs it in one transaction. It does nothing once the check is there,
// or on a new database.

const SQL = `
DO $migration$
DECLARE
  w record;
  s record;
  made uuid;
BEGIN
  IF to_regclass('offerings') IS NULL OR to_regclass('clubspot_sessions') IS NULL
    OR EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offerings_class_with_session') THEN
    RETURN;
  END IF;

  FOR w IN SELECT * FROM offerings WHERE clubspot_class_id IS NOT NULL AND clubspot_session_id IS NULL LOOP
    FOR s IN
      SELECT cs.id, cs.name, cs.start_date, cs.end_date FROM clubspot_sessions cs
        WHERE cs.id IN (
          SELECT sc.session_id FROM clubspot_session_classes sc
            JOIN clubspot_sessions live ON live.id = sc.session_id
            WHERE sc.class_id = w.clubspot_class_id AND NOT live.archived
          UNION
          SELECT e.session_id FROM registrations r JOIN clubspot_registration_entries e ON e.id = r.clubspot_entry_id
            WHERE r.offering_id = w.id
        )
        ORDER BY cs.start_date, cs.id
    LOOP
      SELECT id INTO made FROM offerings WHERE clubspot_class_id = w.clubspot_class_id AND clubspot_session_id = s.id;
      IF made IS NULL THEN
        made := gen_random_uuid();
        INSERT INTO offerings (id, product_id, name, registration_form_id, starts_on, ends_on, price_cents, capacity,
            archived_at, clubspot_class_id, clubspot_session_id, confirmed_count)
          VALUES (made, w.product_id, coalesce(s.name, w.name), w.registration_form_id, s.start_date, s.end_date,
            w.price_cents,
            -- Clubspot lists some class and session pairs twice; the larger cap counts, as clubspot-sync reads it.
            (SELECT max(c.cap) FROM clubspot_entry_caps c WHERE c.class_id = w.clubspot_class_id AND c.session_id = s.id),
            w.archived_at, w.clubspot_class_id, s.id, 0);
        IF to_regclass('offering_schedule') IS NOT NULL THEN
          INSERT INTO offering_schedule (id, offering_id, weekday, start_time, end_time)
            SELECT gen_random_uuid(), made, weekday, start_time, end_time FROM offering_schedule WHERE offering_id = w.id;
        END IF;
      END IF;
      UPDATE registrations r SET offering_id = made
        FROM clubspot_registration_entries e
        WHERE e.id = r.clubspot_entry_id AND r.offering_id = w.id AND e.session_id = s.id;
      IF to_regclass('activities') IS NOT NULL THEN
        UPDATE activities SET offering_id = made
          WHERE offering_id = w.id AND date BETWEEN s.start_date AND s.end_date;
      END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM registrations WHERE offering_id = w.id) THEN
      RAISE EXCEPTION 'cyc0032: offering % keeps registrations no session of its class takes', w.id;
    END IF;
    -- Nested, because PL/pgSQL prepares a statement only when it reaches it.
    IF to_regclass('activities') IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM activities WHERE offering_id = w.id) THEN
        RAISE EXCEPTION 'cyc0032: offering % keeps activities on days none of its sessions has', w.id;
      END IF;
    END IF;
    DELETE FROM offerings WHERE id = w.id;
  END LOOP;

  UPDATE offerings o SET confirmed_count = (
    SELECT count(*) FROM registrations r WHERE r.offering_id = o.id AND r.status = 'confirmed'
  ) WHERE o.clubspot_session_id IS NOT NULL;

  ALTER TABLE offerings ADD CONSTRAINT offerings_class_with_session
    CHECK ((clubspot_class_id IS NULL) = (clubspot_session_id IS NULL));
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// One way: the whole-class offerings are gone.
async function down() {}

module.exports = { up, down, SQL };
