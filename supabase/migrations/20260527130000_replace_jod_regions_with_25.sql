-- Replace current JOD geo regions with the 25-region structure.
-- Canonical/alias split: sub-localities providers may operate in
-- independently (sectors, phases, named roads) are canonical areas.
-- Only label-style synonyms and pure descriptors are aliases.
--
-- Uses existing service_regions / service_region_areas /
-- service_region_area_aliases tables only. No new tables, no hard
-- deletes, no matching changes. Rollback SQL is documented in the
-- companion plan; the notes-marker pattern lets rollback target
-- exactly the rows this migration touched.

BEGIN;

-- ── 1. Soft-deactivate currently-active OLD JOD geo rows ──────────────
-- Filter: only rows that ARE currently active AND DO NOT use the new
-- JOD-NN naming. Skips already-inactive rows so we don't churn them,
-- and skips the new rows we're about to insert. Notes marker is
-- appended (not replaced) so any existing admin note is preserved.
UPDATE public.service_region_area_aliases
   SET active = false,
       notes  = COALESCE(notes, '') ||
                ' [deactivated 2026-05-28 JOD-25-region-migration]'
 WHERE city_code  = 'JOD'
   AND active     = true
   AND alias_code NOT LIKE 'JOD-%';

UPDATE public.service_region_areas
   SET active = false,
       notes  = COALESCE(notes, '') ||
                ' [deactivated 2026-05-28 JOD-25-region-migration]'
 WHERE city_code = 'JOD'
   AND active    = true
   AND area_code NOT LIKE 'JOD-%';

UPDATE public.service_regions
   SET active = false,
       notes  = COALESCE(notes, '') ||
                ' [deactivated 2026-05-28 JOD-25-region-migration]'
 WHERE city_code   = 'JOD'
   AND active      = true
   AND region_code NOT LIKE 'JOD-%';

-- ── 2. Insert the 25 new regions (active=true) ────────────────────────
INSERT INTO public.service_regions
  (region_code, region_name, city_code, active, notes)
VALUES
  ('JOD-01', 'Sardarpura',        'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-02', 'Shastri Nagar',     'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-03', 'Ratanada',          'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-04', 'Paota',             'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-05', 'CHB Early',         'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-06', 'CHB Late',          'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-07', 'Old City',          'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-08', 'Masuria',           'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-09', 'Mandore',           'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-10', 'Basni Industrial',  'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-11', 'Pal Road',          'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-12', 'Banar Road',        'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-13', 'Magra Punjla',      'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-14', 'Station Area',      'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-15', 'Uday Mandir',       'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-16', 'Bhagat Ki Kothi',   'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-17', 'University Area',   'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-18', 'Salawas Road',      'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-19', 'Mahamandir',        'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-20', 'Kudi Bhagtasni',    'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-21', 'Tanawada',          'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-22', 'Nandri',            'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-23', 'Jhalamand',         'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-24', 'BJS Colony',        'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-25', 'Boranada',          'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]')
ON CONFLICT (region_code) DO NOTHING;

-- ── 3. Insert canonical areas (123 rows, active=true) ─────────────────
INSERT INTO public.service_region_areas
  (area_code, canonical_area, region_code, city_code, active, notes)
VALUES
  -- JOD-01 Sardarpura (15)
  ('JOD-01-A001', 'Sardarpura',           'JOD-01', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-01-A002', 'Sardarpura A Sector',  'JOD-01', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-01-A003', 'Sardarpura B Sector',  'JOD-01', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-01-A004', 'Sardarpura C Sector',  'JOD-01', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-01-A005', 'Sardarpura D Sector',  'JOD-01', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-01-A006', '1st Chopasni Road',    'JOD-01', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-01-A007', '2nd Chopasni Road',    'JOD-01', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-01-A008', '3rd Chopasni Road',    'JOD-01', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-01-A009', '4th Chopasni Road',    'JOD-01', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-01-A010', '5th Chopasni Road',    'JOD-01', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-01-A011', '6th Chopasni Road',    'JOD-01', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-01-A012', '7th Chopasni Road',    'JOD-01', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-01-A013', '8th Chopasni Road',    'JOD-01', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-01-A014', '9th Chopasni Road',    'JOD-01', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-01-A015', '10th Chopasni Road',   'JOD-01', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-02 Shastri Nagar (10)
  ('JOD-02-A001', 'Shastri Nagar',          'JOD-02', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-02-A002', 'Shastri Nagar Main',     'JOD-02', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-02-A003', 'Shastri Nagar Sector A', 'JOD-02', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-02-A004', 'Shastri Nagar Sector B', 'JOD-02', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-02-A005', 'Shastri Nagar Sector C', 'JOD-02', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-02-A006', 'Shastri Nagar Sector D', 'JOD-02', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-02-A007', 'Shastri Nagar Sector E', 'JOD-02', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-02-A008', 'Shastri Nagar Sector F', 'JOD-02', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-02-A009', 'Shastri Nagar Sector G', 'JOD-02', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-02-A010', '12th Road',              'JOD-02', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-03 Ratanada (5)
  ('JOD-03-A001', 'Ratanada',        'JOD-03', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-03-A002', 'Airport Area',    'JOD-03', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-03-A003', 'Circuit House',   'JOD-03', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-03-A004', 'Air Force Area',  'JOD-03', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-03-A005', 'Residency Road',  'JOD-03', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-04 Paota (4)
  ('JOD-04-A001', 'Paota',                'JOD-04', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-04-A002', 'Residency Road North', 'JOD-04', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-04-A003', 'Paota B Road',         'JOD-04', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-04-A004', 'Paota C Road',         'JOD-04', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-05 CHB Early (11)
  ('JOD-05-A001', 'Chopasni Housing Board (Sector 1-10)', 'JOD-05', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-05-A002', 'CHB Sector 1',  'JOD-05', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-05-A003', 'CHB Sector 2',  'JOD-05', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-05-A004', 'CHB Sector 3',  'JOD-05', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-05-A005', 'CHB Sector 4',  'JOD-05', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-05-A006', 'CHB Sector 5',  'JOD-05', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-05-A007', 'CHB Sector 6',  'JOD-05', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-05-A008', 'CHB Sector 7',  'JOD-05', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-05-A009', 'CHB Sector 8',  'JOD-05', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-05-A010', 'CHB Sector 9',  'JOD-05', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-05-A011', 'CHB Sector 10', 'JOD-05', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-06 CHB Late (12)
  ('JOD-06-A001', 'Chopasni Housing Board (Sector 11-20)', 'JOD-06', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-06-A002', 'CHB Sector 11',  'JOD-06', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-06-A003', 'CHB Sector 12',  'JOD-06', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-06-A004', 'CHB Sector 13',  'JOD-06', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-06-A005', 'CHB Sector 14',  'JOD-06', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-06-A006', 'CHB Sector 15',  'JOD-06', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-06-A007', 'CHB Sector 16',  'JOD-06', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-06-A008', 'CHB Sector 17',  'JOD-06', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-06-A009', 'CHB Sector 18',  'JOD-06', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-06-A010', 'CHB Sector 19',  'JOD-06', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-06-A011', 'CHB Sector 20',  'JOD-06', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-06-A012', 'Kudi Extension', 'JOD-06', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-07 Old City (6)
  ('JOD-07-A001', 'Old City',      'JOD-07', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-07-A002', 'Clock Tower',   'JOD-07', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-07-A003', 'Sojati Gate',   'JOD-07', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-07-A004', 'Jalori Gate',   'JOD-07', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-07-A005', 'Merti Gate',    'JOD-07', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-07-A006', 'Sardar Market', 'JOD-07', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-08 Masuria (4)
  ('JOD-08-A001', 'Masuria',        'JOD-08', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-08-A002', 'Pratap Nagar',   'JOD-08', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-08-A003', 'Masuria Colony', 'JOD-08', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-08-A004', 'Bapu Nagar',     'JOD-08', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-09 Mandore (4)
  ('JOD-09-A001', 'Mandore',               'JOD-09', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-09-A002', 'Mandore Road',          'JOD-09', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-09-A003', 'Surpura',               'JOD-09', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-09-A004', 'Mandore Gardens Area',  'JOD-09', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-10 Basni Industrial (5)
  ('JOD-10-A001', 'Basni Industrial',      'JOD-10', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-10-A002', 'Heavy Industrial Area', 'JOD-10', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-10-A003', 'Basni Phase I',         'JOD-10', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-10-A004', 'Basni Phase II',        'JOD-10', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-10-A005', 'Basni Phase III',       'JOD-10', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-11 Pal Road (4)
  ('JOD-11-A001', 'Pal Road',   'JOD-11', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-11-A002', 'Pal Gaon',   'JOD-11', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-11-A003', 'Sangariya',  'JOD-11', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-11-A004', 'Pal Bypass', 'JOD-11', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-12 Banar Road (4)
  ('JOD-12-A001', 'Banar Road',              'JOD-12', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-12-A002', 'Banar',                   'JOD-12', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-12-A003', 'Kanasar',                 'JOD-12', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-12-A004', 'Jodhpur-Nagaur Highway',  'JOD-12', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-13 Magra Punjla (3)
  ('JOD-13-A001', 'Magra Punjla', 'JOD-13', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-13-A002', 'Digari',       'JOD-13', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-13-A003', 'Nagaur Road',  'JOD-13', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-14 Station Area (4)
  ('JOD-14-A001', 'Station Area',            'JOD-14', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-14-A002', 'Rai Ka Bagh',             'JOD-14', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-14-A003', 'Jodhpur Railway Station', 'JOD-14', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-14-A004', 'Station Road',            'JOD-14', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-15 Uday Mandir (3)
  ('JOD-15-A001', 'Uday Mandir', 'JOD-15', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-15-A002', 'Nai Sarak',   'JOD-15', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-15-A003', 'Girdikot',    'JOD-15', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-16 Bhagat Ki Kothi (3)
  ('JOD-16-A001', 'Bhagat Ki Kothi', 'JOD-16', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-16-A002', 'New Pali Road',   'JOD-16', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-16-A003', 'Pali Road',       'JOD-16', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-17 University Area (4)
  ('JOD-17-A001', 'University Area',         'JOD-17', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-17-A002', 'MBM Engineering College', 'JOD-17', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-17-A003', 'Residency',               'JOD-17', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-17-A004', 'Residency Road West',     'JOD-17', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-18 Salawas Road (3)
  ('JOD-18-A001', 'Salawas Road',             'JOD-18', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-18-A002', 'Salawas',                  'JOD-18', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-18-A003', 'New Pali Road Extension',  'JOD-18', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-19 Mahamandir (1)
  ('JOD-19-A001', 'Mahamandir', 'JOD-19', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-20 Kudi Bhagtasni (9)
  ('JOD-20-A001', 'Kudi Bhagtasni',          'JOD-20', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-20-A002', 'Kudi Bhagtasni Sector 1', 'JOD-20', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-20-A003', 'Kudi Bhagtasni Sector 2', 'JOD-20', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-20-A004', 'Kudi Bhagtasni Sector 3', 'JOD-20', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-20-A005', 'Kudi Bhagtasni Sector 4', 'JOD-20', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-20-A006', 'Kudi Bhagtasni Sector 5', 'JOD-20', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-20-A007', 'Kudi Bhagtasni Sector 6', 'JOD-20', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-20-A008', 'Kudi Bhagtasni Sector 7', 'JOD-20', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-20-A009', 'Kudi Bhagtasni Sector 8', 'JOD-20', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-21 Tanawada (2)
  ('JOD-21-A001', 'Tanawada',        'JOD-21', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-21-A002', 'Pali Road Outer', 'JOD-21', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-22 Nandri (2)
  ('JOD-22-A001', 'Nandri',         'JOD-22', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-22-A002', 'Jaisalmer Road', 'JOD-22', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-23 Jhalamand (2)
  ('JOD-23-A001', 'Jhalamand',                 'JOD-23', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-23-A002', 'Pali Road Bypass Junction', 'JOD-23', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-24 BJS Colony (1)
  ('JOD-24-A001', 'BJS Colony', 'JOD-24', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  -- JOD-25 Boranada (2)
  ('JOD-25-A001', 'Boranada',                 'JOD-25', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-25-A002', 'Boranada Industrial Area', 'JOD-25', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]')
ON CONFLICT (area_code) DO NOTHING;

-- ── 4. Insert aliases (6 rows, active=true) ───────────────────────────
INSERT INTO public.service_region_area_aliases
  (alias_code, alias, canonical_area, region_code, city_code, active, notes)
VALUES
  ('JOD-05-AL001', 'CHB Early',                    'Chopasni Housing Board (Sector 1-10)',  'JOD-05', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-06-AL001', 'CHB Late',                     'Chopasni Housing Board (Sector 11-20)', 'JOD-06', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-19-AL001', 'Mahamandir Area',              'Mahamandir',                            'JOD-19', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-19-AL002', 'Mandore Road Intersection',    'Mahamandir',                            'JOD-19', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-20-AL001', 'Kudi Bhagtasni Housing Board', 'Kudi Bhagtasni',                        'JOD-20', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]'),
  ('JOD-25-AL001', 'Outer Jodhpur',                'Boranada',                              'JOD-25', 'JOD', true, '[inserted 2026-05-28 JOD-25-region-migration]')
ON CONFLICT (alias_code) DO NOTHING;

-- ── 5. In-transaction sanity assertions ───────────────────────────────
-- Loud failure aborts the transaction. Better than committing a partial
-- migration that the homepage would render half-correct.
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM public.service_regions
       WHERE city_code='JOD' AND region_code LIKE 'JOD-%' AND active=true) <> 25
  THEN RAISE EXCEPTION 'expected 25 active JOD-NN regions';
  END IF;

  IF (SELECT COUNT(*) FROM public.service_region_areas
       WHERE city_code='JOD' AND area_code LIKE 'JOD-%' AND active=true) <> 123
  THEN RAISE EXCEPTION 'expected 123 active JOD-NN areas';
  END IF;

  IF (SELECT COUNT(*) FROM public.service_region_area_aliases
       WHERE city_code='JOD' AND alias_code LIKE 'JOD-%' AND active=true) <> 6
  THEN RAISE EXCEPTION 'expected 6 active JOD-NN aliases';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.service_regions
     WHERE city_code='JOD' AND region_code NOT LIKE 'JOD-%' AND active=true
  ) THEN RAISE EXCEPTION 'old JOD region still active — deactivation incomplete';
  END IF;
END $$;

COMMIT;
