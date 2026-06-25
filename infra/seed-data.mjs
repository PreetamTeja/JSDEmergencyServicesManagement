#!/usr/bin/env node
/* =====================================================================
   PSIOG Transport - seed reference + fleet + shuttle cards into DynamoDB.
   Run in AWS CloudShell (Node + AWS CLI present):
     AWS_REGION=eu-west-1 node seed-data.mjs
     PREFIX=dev- AWS_REGION=eu-west-1 node seed-data.mjs
   Idempotent: PutItem overwrites, so re-running is safe.
   ===================================================================== */
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const REGION = process.env.AWS_REGION || 'eu-west-1'
const PREFIX = process.env.PREFIX || ''
const T = (n) => `${PREFIX}${n}`

/* ---------- data (mirrors the app's current dataset) ---------- */
const LOCATIONS = [
  ['loc-gate','Factory Main Gate','industrial',22.7710,86.2080],
  ['loc-bistupur','Bistupur Quarters','residential',22.8012,86.1856],
  ['loc-sakchi','Sakchi Quarters','residential',22.8045,86.2057],
  ['loc-kadma','Kadma Quarters','residential',22.7942,86.1719],
  ['loc-sonari','Sonari Quarters','residential',22.7860,86.1640],
  ['loc-tmh','Tata Main Hospital','hospital',22.7868,86.1958],
  ['loc-school','Loyola Campus School','education',22.7991,86.1972],
  ['loc-station','Tatanagar Railway Station','transport',22.7846,86.1842],
  ['loc-workshop','Central Workshop','industrial',22.7665,86.2151],
  ['loc-fuel','Fuel Station Depot','fuel',22.7732,86.2012],
  ['loc-jubilee','Jubilee Park Hub','civic',22.8030,86.1990],
  ['loc-aerodrome','Sonari Aerodrome','transport',22.8123,86.1689],
  ['loc-gymkhana','Tata Steel Gymkhana','recreation',22.8026,86.1861],
  ['loc-keenan','Keenan Stadium','recreation',22.7997,86.1986],
  ['loc-jrd','JRD Tata Sports Complex','recreation',22.7746,86.1496],
  ['loc-beldih','Beldih Club (Banquet)','venue',22.8016,86.1902],
  ['loc-zoo','Tata Steel Zoological Park','recreation',22.8047,86.2012],
  ['loc-sakchimkt','Sakchi Market','market',22.8057,86.2043],
  ['loc-bistmkt','Bistupur Market','market',22.8020,86.1870],
  ['loc-kadmamkt','Kadma Market','market',22.7951,86.1722],
  ['loc-sonnet','Hotel Sonnet','commercial',22.8042,86.2051],
  ['loc-xlri','XLRI Jamshedpur','education',22.7783,86.1442],
  ['loc-nit','NIT Jamshedpur','education',22.7771,86.1449],
  ['loc-dbms','DBMS College','education',22.8061,86.2055],
  ['loc-golmuri','Golmuri Circle','civic',22.8001,86.2201],
  ['loc-mango','Mango Bus Stand','transport',22.8331,86.2081],
  ['loc-domuhani','Marine Drive (Domuhani)','civic',22.8201,86.2050],
  ['loc-telco','Telco Colony','residential',22.7847,86.1301],
  ['loc-burma','Burma Mines','industrial',22.8051,86.2351],
  ['loc-russi','Russi Modi Centre','civic',22.7991,86.1901],
].map(([id,name,type,lat,lng]) => ({ id,name,type,lat,lng }))

const ZONES = [
  { id:'zone-bistupur', name:'Bistupur', color:'#2563eb', ref:{lat:22.8012,lng:86.1856}, polygon:[[22.794,86.176],[22.809,86.180],[22.808,86.196],[22.793,86.194]] },
  { id:'zone-sakchi', name:'Sakchi', color:'#16a34a', ref:{lat:22.8045,lng:86.2057}, polygon:[[22.797,86.198],[22.812,86.200],[22.811,86.214],[22.796,86.213]] },
  { id:'zone-kadma', name:'Kadma', color:'#d97706', ref:{lat:22.7942,lng:86.1719}, polygon:[[22.787,86.164],[22.802,86.167],[22.801,86.181],[22.786,86.179]] },
  { id:'zone-sonari', name:'Sonari', color:'#9333ea', ref:{lat:22.7860,lng:86.1640}, polygon:[[22.779,86.156],[22.794,86.159],[22.815,86.171],[22.800,86.176],[22.780,86.172]] },
  { id:'zone-factory', name:'Factory', color:'#dc2626', ref:{lat:22.7710,lng:86.2080}, polygon:[[22.760,86.200],[22.778,86.205],[22.772,86.224],[22.758,86.218]] },
]

const HOSPITALS = [
  { id:'hosp-tmh', name:'Tata Main Hospital', lat:22.7868, lng:86.1958, specialties:['Cardiac','Trauma','General','Maternity','Pediatric'], capability:5, beds_available:18, status:'open' },
  { id:'hosp-tmotors', name:'Tata Motors Hospital', lat:22.7805, lng:86.1492, specialties:['Trauma','General','Pediatric'], capability:4, beds_available:9, status:'open' },
  { id:'hosp-brahmananda', name:'Brahmananda Narayana Multispeciality', lat:22.7741, lng:86.1444, specialties:['Cardiac','Trauma','General'], capability:5, beds_available:6, status:'open' },
  { id:'hosp-mercy', name:'Mercy Hospital', lat:22.8076, lng:86.2031, specialties:['General','Maternity','Pediatric'], capability:3, beds_available:4, status:'open' },
  { id:'hosp-tinplate', name:'Tinplate Hospital', lat:22.7972, lng:86.1572, specialties:['General','Maternity'], capability:2, beds_available:0, status:'full' },
]

// Policy re-keyed by job_level. Each band: highest min_level <= employee.job_level wins.
const POLICY = {
  version:'v2026.06',
  levels:[
    { id:'L9', min_level:9, label:'Executive / Sr. Management', allowed_vehicle_types:['car','van','bus'], monthly_fuel_cap_litres:220, shuttle_rides:60, fare_cap:6000 },
    { id:'L7', min_level:7, label:'Senior Officer', allowed_vehicle_types:['car','van'], monthly_fuel_cap_litres:160, shuttle_rides:45, fare_cap:4500 },
    { id:'L5', min_level:5, label:'Officer', allowed_vehicle_types:['car','bike'], monthly_fuel_cap_litres:110, shuttle_rides:30, fare_cap:3000 },
    { id:'L3', min_level:3, label:'Supervisor / Staff', allowed_vehicle_types:['bike','bus'], monthly_fuel_cap_litres:70, shuttle_rides:20, fare_cap:2000 },
    { id:'L0', min_level:0, label:'Operations / Service', allowed_vehicle_types:['ambulance','van','bus'], monthly_fuel_cap_litres:400, shuttle_rides:40, fare_cap:4000 },
  ],
  vehicle_type_caps:{ bus:600, ambulance:320, van:280, car:180, bike:60 },
}

// Employees, allotments and shuttle cards are NOT seeded:
// - employees live in the shared org table (FP-EMP-TABLE-M)
// - allotments & shuttle cards are created through the app against real employees
const FUEL_LOGS = [
  { id:'f1', vehicleId:'veh-sakchi-bus-1', litres:120, cost:12480, date:'2026-06-03', station:'Fuel Station Depot' },
  { id:'f2', vehicleId:'veh-sakchi-bus-1', litres:90, cost:9360, date:'2026-06-11', station:'Fuel Station Depot' },
  { id:'f3', vehicleId:'veh-factory-bus-1', litres:200, cost:20800, date:'2026-06-05', station:'Fuel Station Depot' },
  { id:'f4', vehicleId:'veh-bistupur-amb-1', litres:60, cost:6240, date:'2026-06-09', station:'Fuel Station Depot' },
  { id:'f5', vehicleId:'veh-kadma-van-1', litres:75, cost:7800, date:'2026-06-12', station:'Fuel Station Depot' },
  { id:'f6', vehicleId:'veh-bistupur-car-1', litres:40, cost:4160, date:'2026-06-14', station:'Fuel Station Depot' },
]

/* ---------- generate campus places + 15 healthcare facilities ---------- */
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 30)
const near = (zoneId, i) => {
  const z = ZONES.find((x) => x.id === zoneId) || ZONES[0]
  const a = (((i * 37) % 10) - 4.5) * 0.0012
  const b = (((i * 53) % 10) - 4.5) * 0.0012
  return { lat: +(z.ref.lat + a).toFixed(4), lng: +(z.ref.lng + b).toFixed(4) }
}
// [name, type, zoneId]
const NEW_PLACES = [
  ['Subarnarekha Riverside Quarters','residential','zone-sonari'],['Steel View Residential Colony','residential','zone-factory'],
  ['Foundry Workers Enclave','residential','zone-factory'],['Sakchi Heritage Quarters','residential','zone-sakchi'],
  ['Blue Furnace Township Residency','residential','zone-factory'],['Mill Workers Welfare Colony','residential','zone-kadma'],
  ['JRD Tata Memorial Hostel','hostel','zone-bistupur'],['Jamsetji Tata Scholars Residence','hostel','zone-bistupur'],
  ['Tata Excellence Scholars Hostel','hostel','zone-sakchi'],['Iron Valley Student Residence','hostel','zone-kadma'],
  ['The Foundry Heritage Restaurant','restaurant','zone-factory'],['Steel City Family Bistro','restaurant','zone-sakchi'],
  ['Annapurna Community Mess','mess','zone-kadma'],['Tata Workers Central Canteen','mess','zone-factory'],
  ['Jubilee Heritage Cinema','theatre','zone-bistupur'],['Tata Cultural Theatre','theatre','zone-sakchi'],
  ['Jubilee Green Gardens','park','zone-bistupur'],['Subarnarekha Riverfront Park','park','zone-sonari'],['Millennium Eco Garden','park','zone-kadma'],
  ['Little Steel Foundation School','school','zone-kadma'],['JRD Tata Memorial High School','school','zone-bistupur'],['Jamsetji Tata Senior Secondary Academy','school','zone-sakchi'],
  ['Fresh Harvest Vegetable Market','grocery','zone-sakchi'],['Steel City Meat and Poultry Market','grocery','zone-factory'],
  ['Steel Mart Township Store','grocery','zone-bistupur'],['Township Central Super Bazaar','grocery','zone-kadma'],
  ['Blast Furnace Energy Station','power','zone-factory'],['Subarnarekha Thermal Power Complex','power','zone-sonari'],
  ['Tata Township Energy Center','power','zone-factory'],['Iron Grid Electrical Power House','power','zone-kadma'],
  ['Steel Strength Fitness Arena','gym','zone-sakchi'],['Iron Core Sports Gymnasium','gym','zone-kadma'],['Titan Health and Fitness Club','gym','zone-bistupur'],
  ['Jubilee Grand Marriage Hall','venue','zone-bistupur'],['Heritage Marriage Hall','venue','zone-sakchi'],
  ['Tata Township Community Centre','civic','zone-factory'],['Steel Workers Welfare Centre','civic','zone-kadma'],
  ['JRD Tata Cultural Auditorium','venue','zone-bistupur'],['Blue Wave Aquatic Sports Complex','recreation','zone-sakchi'],
]
NEW_PLACES.forEach(([name, type, zone], i) => {
  const c = near(zone, i + 3)
  LOCATIONS.push({ id: 'loc-' + slug(name), name, type, lat: c.lat, lng: c.lng })
})

// 15 healthcare facilities. Multispeciality: zones 1&2 share one, zones 3&4 share one.
const ALL = ['Cardiac','Trauma','General','Maternity','Pediatric']
// [name, tier, specialties, capability, beds, status, zone]
const HFAC = [
  ['Tata Steel Advanced Multi-Speciality Hospital','multi',ALL,5,20,'open','zone-bistupur'],
  ['Subarnarekha Super Speciality Medical Centre','multi',ALL,5,16,'open','zone-kadma'],
  ['Sakchi Community Hospital','medium',['General','Trauma','Pediatric'],3,8,'open','zone-sakchi'],
  ['Steel City General Hospital','medium',['General','Trauma'],3,7,'open','zone-factory'],
  ['Foundry Area Medical Centre','medium',['General','Trauma'],3,5,'open','zone-factory'],
  ['Jubilee Care Hospital','medium',['General','Maternity','Pediatric'],3,6,'open','zone-bistupur'],
  ['JRD Family Health Clinic','clinic',['General'],1,2,'open','zone-sonari'],
  ['Jamsetji General Clinic','clinic',['General'],1,2,'open','zone-bistupur'],
  ['Blue Furnace Dental Clinic','clinic',['General'],1,0,'full','zone-factory'],
  ["Iron Valley Children's Clinic",'clinic',['Pediatric','General'],2,2,'open','zone-kadma'],
  ["Millennium Women's Care Clinic",'clinic',['Maternity','General'],2,2,'open','zone-sakchi'],
  ['Subarnarekha Skin and Wellness Clinic','clinic',['General'],1,0,'full','zone-sonari'],
  ['Steel Township Physiotherapy Centre','clinic',['General'],1,0,'full','zone-kadma'],
  ["Workers' Primary Health Clinic",'clinic',['General'],2,2,'open','zone-factory'],
  ['Township Maternity Clinic','clinic',['Maternity','General'],2,3,'open','zone-bistupur'],
]
HOSPITALS.length = 0
HFAC.forEach(([name, tier, specialties, capability, beds, status, zone], i) => {
  const c = near(zone, i + 1)
  HOSPITALS.push({ id: 'hosp-' + slug(name), name, tier, lat: c.lat, lng: c.lng, specialties, capability, beds_available: beds, status, zone_id: zone })
})

// One fire station per zone.
const FIRESTATIONS = ZONES.map((z, i) => {
  const c = near(z.id, i + 2)
  return { id: `fire-${z.id.replace('zone-', '')}`, name: `${z.name} Fire Station`, lat: c.lat, lng: c.lng, zone_id: z.id, status: 'open' }
})

/* ---------- helpers ---------- */
const R = 6371
const havKm = (a,b) => { const dLat=(b.lat-a.lat)*Math.PI/180, dLng=(b.lng-a.lng)*Math.PI/180, la1=a.lat*Math.PI/180, la2=b.lat*Math.PI/180; const x=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2; return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)) }
const nearestZone = (p) => ZONES.map(z=>({z,d:havKm(p,z.ref)})).sort((a,b)=>a.d-b.d)[0].z.id

// JS value -> DynamoDB AttributeValue
const av = (v) => {
  if (v === null || v === undefined) return { NULL: true }
  if (typeof v === 'number') return { N: String(v) }
  if (typeof v === 'boolean') return { BOOL: v }
  if (Array.isArray(v)) return { L: v.map(av) }
  if (typeof v === 'object') return { M: Object.fromEntries(Object.entries(v).map(([k,val])=>[k,av(val)])) }
  return { S: String(v) }
}
const item = (obj) => Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,av(v)]))

let n = 0
const put = (table, obj) => {
  writeFileSync('/tmp/psiog_item.json', JSON.stringify(item(obj)))
  execSync(`aws dynamodb put-item --table-name ${T(table)} --region ${REGION} --item file:///tmp/psiog_item.json`, { stdio: 'ignore' })
  n++
}
// Delete all items in ReferenceData under a given PK (used to clear stale rows).
const clearPK = (pk) => {
  try {
    const out = execSync(`aws dynamodb query --table-name ${T('ReferenceData')} --region ${REGION} --key-condition-expression "PK = :p" --expression-attribute-values '{":p":{"S":"${pk}"}}' --projection-expression "PK,SK" --output json`, { encoding: 'utf8' })
    const items = JSON.parse(out).Items || []
    for (const it of items) {
      writeFileSync('/tmp/psiog_key.json', JSON.stringify({ PK: it.PK, SK: it.SK }))
      execSync(`aws dynamodb delete-item --table-name ${T('ReferenceData')} --region ${REGION} --key file:///tmp/psiog_key.json`, { stdio: 'ignore' })
    }
    if (items.length) console.log(`  cleared ${items.length} stale ${pk} rows`)
  } catch {}
}

/* ---------- 1) ReferenceData ---------- */
console.log('Seeding ReferenceData ...')
// Locations live in ReferenceData under PK="LOC" (SK = location id), which is what
// the API's loadRef() reads. Writing here by SK leaves blood-bank LOC rows intact.
for (const l of LOCATIONS) {
  const zone_id = nearestZone(l)
  put('ReferenceData', { PK:'LOC', SK:l.id, id:l.id, name:l.name, type:l.type, lat:l.lat, lng:l.lng, zone_id, active:true, version:1 })
}
for (const z of ZONES) put('ReferenceData', { PK:'ZONE', SK:z.id, ...z, version:1 })
clearPK('HOSP') // remove stale hospital rows before writing the new set
for (const h of HOSPITALS) put('ReferenceData', { PK:'HOSP', SK:h.id, ...h, version:1 })
clearPK('FIRE')
for (const f of FIRESTATIONS) put('ReferenceData', { PK:'FIRE', SK:f.id, ...f, version:1 })
put('ReferenceData', { PK:'POLICY', SK:POLICY.version, ...POLICY })

// NOTE: Employees are NOT seeded here. They live in the shared org table
// EP50-EMP-TABLE-D (owned by HR/IAM); Transport only reads it.

/* ---------- 2) Fleet (zone pools: 1 ambulance,1 bus,2 car,1 van,1 bike per zone) ---------- */
console.log('Seeding Fleet ...')
const LICENSE = { ambulance:'AMB', bus:'HMV', car:'LMV', van:'LMV', bike:'MC', firetruck:'HMV' }
const REGP = { ambulance:'AM', bus:'BG', car:'CR', van:'VN', bike:'MC', firetruck:'FT' }
const POOL = [['ambulance',5],['bus',1],['car',2],['van',1],['bike',10],['firetruck',2]]  // per zone -> 25 ambulances, 50 bikes, 10 fire trucks
const NAMES = ['Ranjan Mahato','Sunita Devi','Imran Ansari','Bikash Soren','Priya Kumari','Arvind Singh','Fatima Khatun','Deepak Oraon','Manoj Gupta','Reena Tudu','Sanjay Hembrom','Anita Mahto','Wasim Akhtar','Pooja Sinha','Rakesh Munda','N. Lakra','Naveen Kujur','Sarita Devi','Tarun Bhakat','Mohan Das','Jyoti Kerketta','Salim Khan','Geeta Bauri','Vivek Ranjan','Asha Topno','R. Prasad','D. Singh','M. Khan','P. Roy','K. Das']
let di = 0, regc = {}
for (const z of ZONES) {
  const short = z.id.replace('zone-','')
  for (const [type, cnt] of POOL) {
    for (let k=1;k<=cnt;k++) {
      regc[type]=(regc[type]||0)+1
      const vid = `veh-${short}-${type.slice(0,3)}-${k}`
      const did = `drv-${short}-${type.slice(0,3)}-${k}`  // deterministic per vehicle (idempotent reseed)
      const reg = `JH05-${REGP[type]}-${String(1000+regc[type]*7).slice(0,4)}`
      const status = 'idle'
      put('Fleet', {
        PK:`VEH#${vid}`, SK:'META', id:vid, reg, type, status, home_zone_id:z.id, driver_id:did,
        odometer:15000+(di*1234)%80000, fuel:35+(di*17)%60, next_service:'2026-07-15',
        GSI1PK:`ZONE#${z.id}#VEH`, GSI1SK:`${status}#${type}#${vid}`,
        GSI3PK:`VEHSTATUS#${status}`, GSI3SK:vid,
      })
      put('Fleet', {
        PK:`DRV#${did}`, SK:'META', id:did, name:NAMES[di%NAMES.length], license:LICENSE[type],
        status:'available', home_zone_id:z.id, assignment:null,
        GSI2PK:`ZONE#${z.id}#DRV`, GSI2SK:`available#${did}`,
      })
      di++
    }
  }
}

/* ---------- 2b) Fuel logs (Fleet table) ---------- */
console.log('Seeding Fuel logs ...')
for (const f of FUEL_LOGS) put('Fleet', { PK:`VEH#${f.vehicleId}`, SK:`FUEL#${f.date}#${f.id}`, ...f })

console.log(`\nDone. ${n} items written to ${REGION}${PREFIX?` (prefix '${PREFIX}')`:''}.`)
