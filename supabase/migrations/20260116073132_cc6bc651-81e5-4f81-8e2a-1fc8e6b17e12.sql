-- Insert remaining US states jurisdictions (30 states not yet covered)
-- Already have: CT, DC, FL, GA, IA, IL, IN, MA, MD, MI, MN, MO, NC, NJ, NY, OH, PA, SC, VA, WI

-- Texas
INSERT INTO public.jurisdictions (name, state, city, county, is_active, is_high_volume, data_source, plan_review_sla_days, permit_issuance_sla_days, inspection_sla_days, base_permit_fee, plan_review_fee, inspection_fee, submission_methods, accepted_file_formats, notes) VALUES
('Houston', 'TX', 'Houston', 'Harris', true, true, 'manual_research', 30, 10, 2, 500, 350, 125, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'Largest TX city. Houston Permitting Center. No zoning code.'),
('Dallas', 'TX', 'Dallas', 'Dallas', true, true, 'manual_research', 28, 10, 2, 475, 325, 115, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'DevelopDallas portal. Pre-development meetings recommended.'),
('San Antonio', 'TX', 'San Antonio', 'Bexar', true, true, 'manual_research', 25, 8, 2, 425, 275, 100, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Fast-growing. Military base considerations in some areas.'),
('Austin', 'TX', 'Austin', 'Travis', true, true, 'manual_research', 35, 12, 2, 550, 400, 135, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'High demand. Longer review times. Sustainability requirements.'),
('Fort Worth', 'TX', 'Fort Worth', 'Tarrant', true, false, 'manual_research', 21, 7, 2, 375, 250, 90, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Growing rapidly. More efficient than Dallas.'),
('El Paso', 'TX', 'El Paso', 'El Paso', true, false, 'manual_research', 18, 6, 2, 300, 200, 80, ARRAY['online', 'email'], ARRAY['pdf'], 'Border city. Bilingual services available.'),

-- California
('Los Angeles', 'CA', 'Los Angeles', 'Los Angeles', true, true, 'manual_research', 45, 15, 3, 650, 500, 175, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'LADBS. Complex process. Plan check appointments required.'),
('San Diego', 'CA', 'San Diego', 'San Diego', true, true, 'manual_research', 35, 12, 2, 550, 400, 150, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'DSD online portal. Coastal commission in some areas.'),
('San Francisco', 'CA', 'San Francisco', 'San Francisco', true, true, 'manual_research', 60, 20, 3, 750, 600, 200, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'DBI. Extensive historic preservation. Seismic requirements.'),
('San Jose', 'CA', 'San Jose', 'Santa Clara', true, true, 'manual_research', 30, 10, 2, 500, 375, 140, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Silicon Valley hub. Strong commercial activity.'),
('Sacramento', 'CA', 'Sacramento', 'Sacramento', true, false, 'manual_research', 28, 10, 2, 450, 325, 120, ARRAY['online', 'in-person'], ARRAY['pdf'], 'State capital. Streamlined residential process.'),
('Fresno', 'CA', 'Fresno', 'Fresno', true, false, 'manual_research', 21, 7, 2, 350, 225, 95, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Central Valley. Agricultural considerations.'),

-- Arizona
('Phoenix', 'AZ', 'Phoenix', 'Maricopa', true, true, 'manual_research', 21, 7, 2, 400, 275, 100, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'Large metro. Efficient online portal. Fast approvals.'),
('Tucson', 'AZ', 'Tucson', 'Pima', true, false, 'manual_research', 18, 6, 2, 325, 200, 85, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Historic districts. Desert sustainability requirements.'),
('Mesa', 'AZ', 'Mesa', 'Maricopa', true, false, 'manual_research', 14, 5, 1, 300, 175, 75, ARRAY['online'], ARRAY['pdf'], 'Suburban Phoenix. Very efficient permit process.'),
('Scottsdale', 'AZ', 'Scottsdale', 'Maricopa', true, false, 'manual_research', 21, 7, 2, 400, 275, 100, ARRAY['online', 'in-person'], ARRAY['pdf'], 'High design standards. Affluent market.'),

-- Colorado
('Denver', 'CO', 'Denver', 'Denver', true, true, 'manual_research', 28, 10, 2, 450, 325, 115, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'Denver CPD. Green building requirements. High altitude considerations.'),
('Colorado Springs', 'CO', 'Colorado Springs', 'El Paso', true, false, 'manual_research', 21, 7, 2, 350, 225, 90, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Military presence. Growing rapidly.'),
('Aurora', 'CO', 'Aurora', 'Arapahoe', true, false, 'manual_research', 18, 6, 2, 325, 200, 80, ARRAY['online'], ARRAY['pdf'], 'Denver suburb. Efficient process.'),
('Fort Collins', 'CO', 'Fort Collins', 'Larimer', true, false, 'manual_research', 21, 7, 2, 375, 250, 95, ARRAY['online', 'in-person'], ARRAY['pdf'], 'University town. Strong sustainability focus.'),

-- Washington
('Seattle', 'WA', 'Seattle', 'King', true, true, 'manual_research', 45, 15, 3, 600, 450, 160, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'SDCI. Complex process. Extensive environmental review.'),
('Spokane', 'WA', 'Spokane', 'Spokane', true, false, 'manual_research', 21, 7, 2, 325, 200, 80, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Eastern WA hub. More straightforward than Seattle.'),
('Tacoma', 'WA', 'Tacoma', 'Pierce', true, false, 'manual_research', 25, 8, 2, 375, 250, 95, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Growing port city. Good transit access.'),
('Bellevue', 'WA', 'Bellevue', 'King', true, false, 'manual_research', 28, 10, 2, 450, 325, 120, ARRAY['online'], ARRAY['pdf'], 'Tech hub. High-rise experience.'),

-- Oregon
('Portland', 'OR', 'Portland', 'Multnomah', true, true, 'manual_research', 35, 12, 2, 500, 375, 135, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'BDS. Strong green building. Urban growth boundary.'),
('Salem', 'OR', 'Salem', 'Marion', true, false, 'manual_research', 21, 7, 2, 325, 200, 80, ARRAY['online', 'in-person'], ARRAY['pdf'], 'State capital. Standard process.'),
('Eugene', 'OR', 'Eugene', 'Lane', true, false, 'manual_research', 21, 7, 2, 350, 225, 85, ARRAY['online', 'in-person'], ARRAY['pdf'], 'University town. Environmental focus.'),

-- Nevada
('Las Vegas', 'NV', 'Las Vegas', 'Clark', true, true, 'manual_research', 21, 7, 2, 400, 275, 100, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'Fast permitting. Pro-development. 24/7 inspection scheduling.'),
('Henderson', 'NV', 'Henderson', 'Clark', true, false, 'manual_research', 18, 6, 2, 350, 225, 85, ARRAY['online'], ARRAY['pdf'], 'Vegas suburb. Very efficient.'),
('Reno', 'NV', 'Reno', 'Washoe', true, false, 'manual_research', 21, 7, 2, 350, 225, 90, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Tech growth. Faster than NV average.'),

-- Utah
('Salt Lake City', 'UT', 'Salt Lake City', 'Salt Lake', true, true, 'manual_research', 25, 8, 2, 400, 275, 100, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'Strong growth. Efficient government. Tech sector boom.'),
('West Valley City', 'UT', 'West Valley City', 'Salt Lake', true, false, 'manual_research', 18, 6, 2, 325, 200, 80, ARRAY['online'], ARRAY['pdf'], 'SLC suburb. Industrial/commercial focus.'),
('Provo', 'UT', 'Provo', 'Utah', true, false, 'manual_research', 21, 7, 2, 350, 225, 85, ARRAY['online', 'in-person'], ARRAY['pdf'], 'University town. Young population growth.'),

-- Tennessee
('Nashville', 'TN', 'Nashville', 'Davidson', true, true, 'manual_research', 28, 10, 2, 425, 300, 110, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'Booming market. Codes department modernized.'),
('Memphis', 'TN', 'Memphis', 'Shelby', true, false, 'manual_research', 25, 8, 2, 375, 250, 95, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Logistics hub. Straightforward process.'),
('Knoxville', 'TN', 'Knoxville', 'Knox', true, false, 'manual_research', 21, 7, 2, 325, 200, 80, ARRAY['online', 'in-person'], ARRAY['pdf'], 'University town. Growing tech sector.'),
('Chattanooga', 'TN', 'Chattanooga', 'Hamilton', true, false, 'manual_research', 18, 6, 2, 300, 175, 75, ARRAY['online'], ARRAY['pdf'], 'Tech-forward city. Gigabit internet pioneer.'),

-- Kentucky
('Louisville', 'KY', 'Louisville', 'Jefferson', true, false, 'manual_research', 25, 8, 2, 375, 250, 95, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Largest KY city. Merged city-county government.'),
('Lexington', 'KY', 'Lexington', 'Fayette', true, false, 'manual_research', 21, 7, 2, 325, 200, 80, ARRAY['online', 'in-person'], ARRAY['pdf'], 'University town. Urban service boundary.'),

-- Alabama
('Birmingham', 'AL', 'Birmingham', 'Jefferson', true, false, 'manual_research', 21, 7, 2, 325, 200, 80, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Largest AL city. Revitalization underway.'),
('Huntsville', 'AL', 'Huntsville', 'Madison', true, false, 'manual_research', 18, 6, 2, 300, 175, 75, ARRAY['online'], ARRAY['pdf'], 'Tech/aerospace hub. Fast-growing. Efficient process.'),
('Montgomery', 'AL', 'Montgomery', 'Montgomery', true, false, 'manual_research', 21, 7, 2, 275, 175, 70, ARRAY['online', 'in-person'], ARRAY['pdf'], 'State capital. Standard process.'),

-- Louisiana
('New Orleans', 'LA', 'New Orleans', 'Orleans', true, false, 'manual_research', 35, 12, 2, 425, 300, 110, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Extensive historic preservation. Flood zone requirements.'),
('Baton Rouge', 'LA', 'Baton Rouge', 'East Baton Rouge', true, false, 'manual_research', 21, 7, 2, 350, 225, 90, ARRAY['online', 'in-person'], ARRAY['pdf'], 'State capital. Industrial corridor.'),

-- Mississippi
('Jackson', 'MS', 'Jackson', 'Hinds', true, false, 'manual_research', 18, 6, 2, 275, 175, 70, ARRAY['online', 'in-person'], ARRAY['pdf'], 'State capital. Streamlined process.'),

-- Arkansas
('Little Rock', 'AR', 'Little Rock', 'Pulaski', true, false, 'manual_research', 18, 6, 2, 300, 175, 75, ARRAY['online', 'in-person'], ARRAY['pdf'], 'State capital. Growing metro.'),
('Fayetteville', 'AR', 'Fayetteville', 'Washington', true, false, 'manual_research', 14, 5, 1, 275, 175, 70, ARRAY['online'], ARRAY['pdf'], 'NW Arkansas boom. University town.'),

-- Oklahoma
('Oklahoma City', 'OK', 'Oklahoma City', 'Oklahoma', true, false, 'manual_research', 21, 7, 2, 350, 225, 85, ARRAY['online', 'in-person'], ARRAY['pdf'], 'State capital. Energy sector. Efficient process.'),
('Tulsa', 'OK', 'Tulsa', 'Tulsa', true, false, 'manual_research', 18, 6, 2, 325, 200, 80, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Second largest OK city. Art deco historic districts.'),

-- Kansas
('Kansas City', 'KS', 'Kansas City', 'Wyandotte', true, false, 'manual_research', 21, 7, 2, 325, 200, 80, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Unified government. Coordinate with MO side.'),
('Wichita', 'KS', 'Wichita', 'Sedgwick', true, false, 'manual_research', 18, 6, 2, 300, 175, 75, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Largest KS city. Aerospace industry.'),

-- Nebraska
('Omaha', 'NE', 'Omaha', 'Douglas', true, false, 'manual_research', 21, 7, 2, 350, 225, 85, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Largest NE city. Strong development activity.'),
('Lincoln', 'NE', 'Lincoln', 'Lancaster', true, false, 'manual_research', 18, 6, 2, 300, 175, 75, ARRAY['online', 'in-person'], ARRAY['pdf'], 'State capital. University town.'),

-- South Dakota
('Sioux Falls', 'SD', 'Sioux Falls', 'Minnehaha', true, false, 'manual_research', 14, 5, 1, 275, 175, 70, ARRAY['online'], ARRAY['pdf'], 'Largest SD city. Fast-growing. Business-friendly.'),

-- North Dakota
('Fargo', 'ND', 'Fargo', 'Cass', true, false, 'manual_research', 14, 5, 1, 275, 175, 70, ARRAY['online'], ARRAY['pdf'], 'Largest ND city. Cold climate considerations.'),

-- Montana
('Billings', 'MT', 'Billings', 'Yellowstone', true, false, 'manual_research', 18, 6, 2, 300, 175, 75, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Largest MT city. Energy sector hub.'),
('Missoula', 'MT', 'Missoula', 'Missoula', true, false, 'manual_research', 21, 7, 2, 325, 200, 80, ARRAY['online'], ARRAY['pdf'], 'University town. Environmental considerations.'),

-- Wyoming
('Cheyenne', 'WY', 'Cheyenne', 'Laramie', true, false, 'manual_research', 14, 5, 1, 250, 150, 65, ARRAY['online', 'in-person'], ARRAY['pdf'], 'State capital. Small but efficient.'),

-- Idaho
('Boise', 'ID', 'Boise', 'Ada', true, false, 'manual_research', 25, 8, 2, 375, 250, 95, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Fast-growing. High demand. Tech sector growth.'),
('Meridian', 'ID', 'Meridian', 'Ada', true, false, 'manual_research', 21, 7, 2, 325, 200, 80, ARRAY['online'], ARRAY['pdf'], 'Boise suburb. One of fastest growing US cities.'),

-- New Mexico
('Albuquerque', 'NM', 'Albuquerque', 'Bernalillo', true, false, 'manual_research', 21, 7, 2, 350, 225, 90, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Largest NM city. Adobe/historic considerations.'),
('Santa Fe', 'NM', 'Santa Fe', 'Santa Fe', true, false, 'manual_research', 28, 10, 2, 400, 275, 100, ARRAY['online', 'in-person'], ARRAY['pdf'], 'State capital. Strict historic/architectural standards.'),

-- Hawaii
('Honolulu', 'HI', 'Honolulu', 'Honolulu', true, false, 'manual_research', 45, 15, 3, 600, 450, 160, ARRAY['online', 'in-person'], ARRAY['pdf', 'dwg'], 'Island logistics. Environmental review. High costs.'),

-- Alaska
('Anchorage', 'AK', 'Anchorage', 'Anchorage', true, false, 'manual_research', 21, 7, 2, 400, 275, 100, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Largest AK city. Cold climate/seismic requirements.'),

-- Maine
('Portland', 'ME', 'Portland', 'Cumberland', true, false, 'manual_research', 21, 7, 2, 350, 225, 90, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Largest ME city. Historic waterfront.'),

-- New Hampshire
('Manchester', 'NH', 'Manchester', 'Hillsborough', true, false, 'manual_research', 18, 6, 2, 325, 200, 80, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Largest NH city. No sales tax advantage.'),

-- Vermont
('Burlington', 'VT', 'Burlington', 'Chittenden', true, false, 'manual_research', 21, 7, 2, 350, 225, 90, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Largest VT city. Strong environmental standards.'),

-- Rhode Island
('Providence', 'RI', 'Providence', 'Providence', true, false, 'manual_research', 25, 8, 2, 375, 250, 95, ARRAY['online', 'in-person'], ARRAY['pdf'], 'State capital. Historic preservation focus.'),

-- Delaware
('Wilmington', 'DE', 'Wilmington', 'New Castle', true, false, 'manual_research', 21, 7, 2, 350, 225, 90, ARRAY['online', 'in-person'], ARRAY['pdf'], 'Largest DE city. Corporate-friendly.'),

-- West Virginia
('Charleston', 'WV', 'Charleston', 'Kanawha', true, false, 'manual_research', 18, 6, 2, 275, 175, 70, ARRAY['online', 'in-person'], ARRAY['pdf'], 'State capital. Straightforward process.');