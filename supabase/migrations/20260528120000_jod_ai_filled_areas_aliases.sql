-- AI-filled enrichment draft for the existing 25 Jodhpur regions.
-- Inserts candidate canonical areas + aliases as INACTIVE rows for
-- admin review via the existing AreaTab. Uses existing tables only;
-- no schema changes, no new regions, no hard deletes, no matching
-- changes.
--
-- Code namespace (distinct from JOD-NN-A### / -AL### and JOD-NN-D### / -DL###):
--   areas:   JOD-NN-E###
--   aliases: JOD-NN-EL###
--
-- All rows ship active=false. The notes marker
-- "[AI-filled draft for admin review]" makes rollback a single WHERE.

BEGIN;

-- ── Canonical areas (45 rows) ─────────────────────────────────────────
INSERT INTO public.service_region_areas
  (area_code, canonical_area, region_code, city_code, active, notes)
VALUES
  -- JOD-01 Sardarpura
  ('JOD-01-E001', 'Bombay Motors Circle',     'JOD-01', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-01-E002', 'Tilak Nagar',              'JOD-01', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-02 Shastri Nagar
  ('JOD-02-E001', 'Kamla Nehru Hospital',     'JOD-02', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-02-E002', 'Roop Nagar',               'JOD-02', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-03 Ratanada
  ('JOD-03-E001', 'Polo Ground',              'JOD-03', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-03-E002', 'Ratanada Palace',          'JOD-03', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-03-E003', 'Aerodrome Road',           'JOD-03', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-04 Paota
  ('JOD-04-E001', 'Paota A Road',             'JOD-04', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-04-E002', 'Akhaliya Circle',          'JOD-04', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  ('JOD-04-E003', 'Mahatma Gandhi Hospital',  'JOD-04', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-05 CHB Early
  ('JOD-05-E001', 'CHB Main Road',            'JOD-05', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  -- JOD-06 CHB Late
  ('JOD-06-E001', 'CHB Park',                 'JOD-06', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  -- JOD-07 Old City
  ('JOD-07-E001', 'Tripolia',                 'JOD-07', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-07-E002', 'Sojati Gate Bazaar',       'JOD-07', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  ('JOD-07-E003', 'Khanda Falsa',             'JOD-07', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  ('JOD-07-E004', 'Mahila Bagh',              'JOD-07', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-08 Masuria
  ('JOD-08-E001', 'Masuria Hill',             'JOD-08', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-08-E002', 'Pratap Nagar Stadium',     'JOD-08', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-09 Mandore
  ('JOD-09-E001', 'Mandore Cenotaphs',        'JOD-09', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-09-E002', 'NIIT Campus',              'JOD-09', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  -- JOD-10 Basni Industrial
  ('JOD-10-E001', 'Basni Bus Stand',          'JOD-10', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  ('JOD-10-E002', 'RIICO Basni',              'JOD-10', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  ('JOD-10-E003', 'Basni Pulia',              'JOD-10', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  -- JOD-11 Pal Road
  ('JOD-11-E001', 'Pal Circle',               'JOD-11', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  ('JOD-11-E002', 'Pal Link Road',            'JOD-11', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  ('JOD-11-E003', 'Pal Toll',                 'JOD-11', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  -- JOD-12 Banar Road
  ('JOD-12-E001', 'Banar Crossing',           'JOD-12', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  -- JOD-13 Magra Punjla
  ('JOD-13-E001', 'Magra',                    'JOD-13', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  ('JOD-13-E002', 'Punjla Bhata',             'JOD-13', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  -- JOD-14 Station Area
  ('JOD-14-E001', 'Goods Yard',               'JOD-14', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  ('JOD-14-E002', 'Cantonment',               'JOD-14', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  ('JOD-14-E003', 'Bus Stand',                'JOD-14', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-15 Uday Mandir
  ('JOD-15-E001', 'Uday Mandir Temple',       'JOD-15', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-16 Bhagat Ki Kothi
  ('JOD-16-E001', 'Bhagat Ki Kothi Railway Station', 'JOD-16', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  -- JOD-17 University Area
  ('JOD-17-E001', 'JNVU Campus',              'JOD-17', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-17-E002', 'MBM Hostel',               'JOD-17', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-18 Salawas Road
  ('JOD-18-E001', 'Salawas Village',          'JOD-18', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-19 Mahamandir
  ('JOD-19-E001', 'Mahamandir Temple',          'JOD-19', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-19-E002', 'Mahamandir Circle',          'JOD-19', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  ('JOD-19-E003', 'Mahamandir Police Station',  'JOD-19', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  -- JOD-20 Kudi Bhagtasni
  ('JOD-20-E001', 'Kudi Bhagtasni Main Road', 'JOD-20', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  -- JOD-21 Tanawada
  ('JOD-21-E001', 'Tanawada Village',         'JOD-21', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  -- JOD-22 Nandri
  ('JOD-22-E001', 'Nandri Industrial Area',   'JOD-22', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  -- JOD-23 Jhalamand
  ('JOD-23-E001', 'Jhalamand Circle',         'JOD-23', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  -- JOD-25 Boranada
  ('JOD-25-E001', 'Boranada Village',         'JOD-25', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]')
ON CONFLICT (area_code) DO NOTHING;

-- ── Aliases (55 rows) ─────────────────────────────────────────────────
INSERT INTO public.service_region_area_aliases
  (alias_code, alias, canonical_area, region_code, city_code, active, notes)
VALUES
  -- JOD-01 Sardarpura
  ('JOD-01-EL001', 'Sardarpura A',  'Sardarpura',           'JOD-01', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-01-EL002', 'Sardarpura B',  'Sardarpura',           'JOD-01', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-01-EL003', 'Sardarpura C',  'Sardarpura',           'JOD-01', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-01-EL004', 'Sardarpura D',  'Sardarpura',           'JOD-01', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-01-EL005', 'BM Circle',     'Bombay Motors Circle', 'JOD-01', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-02 Shastri Nagar
  ('JOD-02-EL001', 'Shastri Nagar A', 'Shastri Nagar', 'JOD-02', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-02-EL002', 'Shastri Nagar B', 'Shastri Nagar', 'JOD-02', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-02-EL003', 'Shastri Nagar C', 'Shastri Nagar', 'JOD-02', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-02-EL004', 'Shastri Nagar D', 'Shastri Nagar', 'JOD-02', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-02-EL005', 'Shastri Nagar E', 'Shastri Nagar', 'JOD-02', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-02-EL006', 'Shastri Nagar F', 'Shastri Nagar', 'JOD-02', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-02-EL007', 'Shastri Nagar G', 'Shastri Nagar', 'JOD-02', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-02-EL008', '12 Road',         '12th Road',     'JOD-02', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  -- JOD-03 Ratanada
  ('JOD-03-EL001', 'Air Force Station', 'Air Force Area', 'JOD-03', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-03-EL002', 'Airport',           'Airport Area',   'JOD-03', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  -- JOD-04 Paota
  ('JOD-04-EL001', 'MGH',               'Mahatma Gandhi Hospital', 'JOD-04', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  ('JOD-04-EL002', 'Paota Sabzi Mandi', 'Paota',                   'JOD-04', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-05 CHB Early
  ('JOD-05-EL001', 'CHB Phase 1', 'Chopasni Housing Board (Sector 1-10)', 'JOD-05', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  ('JOD-05-EL002', 'Chopasni HB', 'Chopasni Housing Board (Sector 1-10)', 'JOD-05', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-06 CHB Late
  ('JOD-06-EL001', 'CHB Phase 2',          'Chopasni Housing Board (Sector 11-20)', 'JOD-06', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  ('JOD-06-EL002', 'Kudi Extension Colony', 'Kudi Extension',                       'JOD-06', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  -- JOD-07 Old City
  ('JOD-07-EL001', 'Ghanta Ghar',    'Clock Tower',   'JOD-07', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-07-EL002', 'Sardar Bazar',   'Sardar Market', 'JOD-07', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-07-EL003', 'Walled City',    'Old City',      'JOD-07', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-07-EL004', 'Purana Sheher',  'Old City',      'JOD-07', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  ('JOD-07-EL005', 'Sojati Pol',     'Sojati Gate',   'JOD-07', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  ('JOD-07-EL006', 'Jalori Pol',     'Jalori Gate',   'JOD-07', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  ('JOD-07-EL007', 'Merti Pol',      'Merti Gate',    'JOD-07', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-08 Masuria
  ('JOD-08-EL001', 'Masuria Hills',         'Masuria Hill',  'JOD-08', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  ('JOD-08-EL002', 'Pratap Nagar Colony',   'Pratap Nagar',  'JOD-08', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-09 Mandore
  ('JOD-09-EL001', 'Mandore Garden',  'Mandore Gardens Area', 'JOD-09', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-09-EL002', 'Mandore Park',    'Mandore Gardens Area', 'JOD-09', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  ('JOD-09-EL003', 'Surpura Village', 'Surpura',              'JOD-09', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-10 Basni Industrial
  ('JOD-10-EL001', 'Basni Phase 1', 'Basni Phase I',   'JOD-10', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-10-EL002', 'Basni Phase 2', 'Basni Phase II',  'JOD-10', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-10-EL003', 'Basni Phase 3', 'Basni Phase III', 'JOD-10', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  -- JOD-11 Pal Road
  ('JOD-11-EL001', 'Pal Village',     'Pal Gaon',  'JOD-11', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-11-EL002', 'Sangariya Phata', 'Sangariya', 'JOD-11', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  -- JOD-12 Banar Road
  ('JOD-12-EL001', 'Nagaur Highway', 'Jodhpur-Nagaur Highway', 'JOD-12', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-12-EL002', 'Banar Village',  'Banar',                  'JOD-12', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-13 Magra Punjla
  ('JOD-13-EL001', 'Punjla', 'Magra Punjla', 'JOD-13', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-14 Station Area
  ('JOD-14-EL001', 'Railway Station', 'Jodhpur Railway Station', 'JOD-14', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-14-EL002', 'Jn',              'Jodhpur Railway Station', 'JOD-14', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  ('JOD-14-EL003', 'Rai Bagh',        'Rai Ka Bagh',             'JOD-14', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-15 Uday Mandir
  ('JOD-15-EL001', 'Girdikot Market', 'Girdikot', 'JOD-15', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-16 Bhagat Ki Kothi
  ('JOD-16-EL001', 'BKK',         'Bhagat Ki Kothi',                 'JOD-16', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-16-EL002', 'BKK Station', 'Bhagat Ki Kothi Railway Station', 'JOD-16', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-17 University Area
  ('JOD-17-EL001', 'JNVU',            'University Area',         'JOD-17', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-17-EL002', 'MBM',             'MBM Engineering College', 'JOD-17', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-17-EL003', 'Vyas University', 'University Area',         'JOD-17', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-18 Salawas Road
  ('JOD-18-EL001', 'Salawas Weavers Village', 'Salawas', 'JOD-18', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  -- JOD-20 Kudi Bhagtasni
  ('JOD-20-EL001', 'KBHB', 'Kudi Bhagtasni', 'JOD-20', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  ('JOD-20-EL002', 'Kudi', 'Kudi Bhagtasni', 'JOD-20', 'JOD', false, '[AI-filled draft for admin review] [CONF=MED]'),
  -- JOD-22 Nandri
  ('JOD-22-EL001', 'Nandri Village', 'Nandri', 'JOD-22', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]'),
  -- JOD-24 BJS Colony
  ('JOD-24-EL001', 'B.J.S. Colony', 'BJS Colony', 'JOD-24', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  ('JOD-24-EL002', 'BJS',           'BJS Colony', 'JOD-24', 'JOD', false, '[AI-filled draft for admin review] [CONF=HIGH]'),
  -- JOD-25 Boranada
  ('JOD-25-EL001', 'Boranada Crossing', 'Boranada', 'JOD-25', 'JOD', false, '[AI-filled draft for admin review] [CONF=LOW]')
ON CONFLICT (alias_code) DO NOTHING;

-- ── Sanity assertions ─────────────────────────────────────────────────
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM public.service_region_areas
       WHERE city_code='JOD' AND area_code LIKE 'JOD-__-E%') <> 45
  THEN RAISE EXCEPTION 'expected 45 enrichment areas';
  END IF;

  -- 57 actual rows in the INSERT block. Earlier summary mistakenly
  -- listed 55; the SQL body is the source of truth, not the summary.
  IF (SELECT COUNT(*) FROM public.service_region_area_aliases
       WHERE city_code='JOD' AND alias_code LIKE 'JOD-__-EL%') <> 57
  THEN RAISE EXCEPTION 'expected 57 enrichment aliases';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.service_region_areas
     WHERE area_code LIKE 'JOD-__-E%' AND active = true
  ) THEN RAISE EXCEPTION 'enrichment area unexpectedly active';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.service_region_area_aliases
     WHERE alias_code LIKE 'JOD-__-EL%' AND active = true
  ) THEN RAISE EXCEPTION 'enrichment alias unexpectedly active';
  END IF;
END $$;

COMMIT;
