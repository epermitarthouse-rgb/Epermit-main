-- Insert Midwest jurisdictions (IL, OH, MI, IN, WI, MN, MO, IA)

-- Illinois
INSERT INTO public.jurisdictions (name, state, city, county, is_active, is_high_volume, data_source, plan_review_sla_days, permit_issuance_sla_days, inspection_sla_days, base_permit_fee, plan_review_fee, inspection_fee, submission_methods, accepted_file_formats, notes) VALUES
('Chicago', 'IL', 'Chicago', 'Cook', true, true, 'manual_research', 45, 10, 2, 500, 350, 125, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'Large municipality with complex zoning. DOB online portal required.'),
('Aurora', 'IL', 'Aurora', 'Kane', true, false, 'manual_research', 21, 7, 2, 275, 175, 75, ARRAY['online', 'email'], ARRAY['pdf'], 'Growing suburb. Fast turnaround for residential.'),
('Naperville', 'IL', 'Naperville', 'DuPage', true, false, 'manual_research', 14, 5, 1, 300, 200, 85, ARRAY['online'], ARRAY['pdf'], 'Well-organized permit system. Responsive staff.'),
('Rockford', 'IL', 'Rockford', 'Winnebago', true, false, 'manual_research', 21, 7, 2, 225, 150, 65, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Second largest city in IL. Streamlined residential process.'),
('Joliet', 'IL', 'Joliet', 'Will', true, false, 'manual_research', 18, 6, 2, 250, 160, 70, ARRAY['online', 'email'], ARRAY['pdf'], 'Fast-growing Will County hub.'),
('Springfield', 'IL', 'Springfield', 'Sangamon', true, false, 'manual_research', 14, 5, 1, 200, 125, 60, ARRAY['in-person', 'email'], ARRAY['pdf'], 'State capital. Straightforward process.'),

-- Ohio
('Columbus', 'OH', 'Columbus', 'Franklin', true, true, 'manual_research', 30, 10, 2, 450, 300, 110, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'Fastest growing Midwest city. BuildColumbus portal.'),
('Cleveland', 'OH', 'Cleveland', 'Cuyahoga', true, true, 'manual_research', 35, 10, 2, 400, 275, 100, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Complex historic districts. Pre-submittal meetings recommended.'),
('Cincinnati', 'OH', 'Cincinnati', 'Hamilton', true, true, 'manual_research', 28, 8, 2, 375, 250, 95, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Strong development activity. DOTE coordination required.'),
('Toledo', 'OH', 'Toledo', 'Lucas', true, false, 'manual_research', 21, 7, 2, 275, 175, 75, ARRAY['online', 'email'], ARRAY['pdf'], 'Revitalization underway. Incentive programs available.'),
('Akron', 'OH', 'Akron', 'Summit', true, false, 'manual_research', 18, 6, 2, 250, 160, 70, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Responsive building department.'),
('Dayton', 'OH', 'Dayton', 'Montgomery', true, false, 'manual_research', 21, 7, 2, 225, 150, 65, ARRAY['online', 'email'], ARRAY['pdf'], 'Historic preservation overlay in some areas.'),

-- Michigan
('Detroit', 'MI', 'Detroit', 'Wayne', true, true, 'manual_research', 35, 12, 2, 425, 300, 115, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'Major redevelopment. BSEED online portal. Pre-app meetings helpful.'),
('Grand Rapids', 'MI', 'Grand Rapids', 'Kent', true, false, 'manual_research', 21, 7, 2, 325, 200, 85, ARRAY['online'], ARRAY['pdf'], 'Fast-growing. Very organized permit process.'),
('Warren', 'MI', 'Warren', 'Macomb', true, false, 'manual_research', 18, 6, 2, 275, 175, 75, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Industrial/commercial focus.'),
('Ann Arbor', 'MI', 'Ann Arbor', 'Washtenaw', true, false, 'manual_research', 28, 10, 2, 350, 225, 90, ARRAY['online'], ARRAY['pdf'], 'Strict sustainability requirements. University area restrictions.'),
('Lansing', 'MI', 'Lansing', 'Ingham', true, false, 'manual_research', 21, 7, 2, 275, 175, 75, ARRAY['online', 'email'], ARRAY['pdf'], 'State capital. Standard process.'),

-- Indiana
('Indianapolis', 'IN', 'Indianapolis', 'Marion', true, true, 'manual_research', 28, 10, 2, 400, 275, 100, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'Indy DPW. Unified city-county government simplifies process.'),
('Fort Wayne', 'IN', 'Fort Wayne', 'Allen', true, false, 'manual_research', 21, 7, 2, 300, 200, 80, ARRAY['online', 'email'], ARRAY['pdf'], 'Growing metro. Efficient residential permits.'),
('Evansville', 'IN', 'Evansville', 'Vanderburgh', true, false, 'manual_research', 18, 6, 2, 250, 160, 70, ARRAY['online', 'in-person'], ARRAY['pdf'], 'River city with straightforward process.'),
('South Bend', 'IN', 'South Bend', 'St. Joseph', true, false, 'manual_research', 21, 7, 2, 275, 175, 75, ARRAY['online', 'email'], ARRAY['pdf'], 'University town. Smart growth initiatives.'),
('Carmel', 'IN', 'Carmel', 'Hamilton', true, false, 'manual_research', 14, 5, 1, 350, 225, 90, ARRAY['online'], ARRAY['pdf'], 'Affluent suburb. High design standards. Fast turnaround.'),

-- Wisconsin
('Milwaukee', 'WI', 'Milwaukee', 'Milwaukee', true, true, 'manual_research', 30, 10, 2, 400, 275, 100, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'Largest WI city. DNS permits. Historic district considerations.'),
('Madison', 'WI', 'Madison', 'Dane', true, false, 'manual_research', 28, 10, 2, 375, 250, 95, ARRAY['online'], ARRAY['pdf'], 'State capital/university town. Strong sustainability focus.'),
('Green Bay', 'WI', 'Green Bay', 'Brown', true, false, 'manual_research', 18, 6, 2, 275, 175, 75, ARRAY['online', 'email'], ARRAY['pdf'], 'Efficient permit department.'),
('Kenosha', 'WI', 'Kenosha', 'Kenosha', true, false, 'manual_research', 21, 7, 2, 300, 200, 80, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Growing Chicago commuter suburb.'),

-- Minnesota
('Minneapolis', 'MN', 'Minneapolis', 'Hennepin', true, true, 'manual_research', 30, 10, 2, 425, 300, 110, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'Strong development. Online portal. Energy code focus.'),
('St. Paul', 'MN', 'St. Paul', 'Ramsey', true, false, 'manual_research', 28, 10, 2, 375, 250, 95, ARRAY['online', 'in-person'], ARRAY['pdf'], 'State capital. Historic preservation important.'),
('Rochester', 'MN', 'Rochester', 'Olmsted', true, false, 'manual_research', 21, 7, 2, 325, 200, 85, ARRAY['online'], ARRAY['pdf'], 'Mayo Clinic hub. High construction activity.'),
('Bloomington', 'MN', 'Bloomington', 'Hennepin', true, false, 'manual_research', 18, 6, 2, 300, 200, 80, ARRAY['online'], ARRAY['pdf'], 'Mall of America area. Commercial focus.'),
('Duluth', 'MN', 'Duluth', 'St. Louis', true, false, 'manual_research', 21, 7, 2, 250, 160, 70, ARRAY['online', 'email'], ARRAY['pdf'], 'Port city. Hillside development considerations.'),

-- Missouri
('Kansas City', 'MO', 'Kansas City', 'Jackson', true, true, 'manual_research', 28, 10, 2, 400, 275, 100, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'Spans MO/KS. KCMO codes department. Pre-app recommended.'),
('St. Louis', 'MO', 'St. Louis', 'St. Louis City', true, true, 'manual_research', 35, 12, 2, 425, 300, 110, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'Independent city. Strong historic preservation. Complex process.'),
('Springfield', 'MO', 'Springfield', 'Greene', true, false, 'manual_research', 21, 7, 2, 275, 175, 75, ARRAY['online', 'email'], ARRAY['pdf'], 'Growing Ozarks hub.'),
('Columbia', 'MO', 'Columbia', 'Boone', true, false, 'manual_research', 18, 6, 2, 250, 160, 70, ARRAY['online'], ARRAY['pdf'], 'University town. Smart growth focus.'),

-- Iowa
('Des Moines', 'IA', 'Des Moines', 'Polk', true, false, 'manual_research', 21, 7, 2, 325, 200, 85, ARRAY['online', 'in-person'], ARRAY['pdf'], 'State capital. Strong downtown development.'),
('Cedar Rapids', 'IA', 'Cedar Rapids', 'Linn', true, false, 'manual_research', 18, 6, 2, 275, 175, 75, ARRAY['online', 'email'], ARRAY['pdf'], 'Second largest IA city. Flood mitigation requirements.'),
('Davenport', 'IA', 'Davenport', 'Scott', true, false, 'manual_research', 18, 6, 2, 250, 160, 70, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Quad Cities anchor. Mississippi riverfront.'),
('Iowa City', 'IA', 'Iowa City', 'Johnson', true, false, 'manual_research', 21, 7, 2, 300, 200, 80, ARRAY['online'], ARRAY['pdf'], 'University town. Historic preservation areas.');