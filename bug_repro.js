const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:5000/api';

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  return data.token;
}

async function getState(token) {
  const res = await fetch(`${BASE_URL}/state`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return res.json();
}

async function getLeads(token) {
  const res = await fetch(`${BASE_URL}/leads`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return res.json();
}

async function reassign(token, leadId, newOwnerId) {
  const res = await fetch(`${BASE_URL}/leads/${leadId}/reassign`, {
    method: 'PATCH',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}` 
    },
    body: JSON.stringify({ ownerId: newOwnerId })
  });
  return res.json();
}

async function run() {
  console.log("=== Logging in as Admin (Vignesh) ===");
  const adminToken = await login('vignesh@lykaone.com', 'Vignesh@1234');
  
  const initialState = await getState(adminToken);
  let ld01 = initialState.state.leads.find(l => l.leadCode === 'LD-01');
  let u01 = initialState.state.users.find(u => u.userCode === 'U-01');
  
  console.log("Before reassignment LD-01 ownerId:", ld01.ownerId);
  console.log("U-01 _id in DB:", u01.id);
  console.log("U-01 userCode in DB:", u01.userCode);
  
  console.log("\n=== Reassigning LD-01 to U-01 (Ravi) ===");
  // We need to know what the frontend actually sends. The frontend dropdown might send userCode!
  // Let's first test what happens if we reassign. I'll check how reassign endpoint works.
  const reassignRes = await reassign(adminToken, ld01.id, u01.id);
  console.log("Reassign response with u01.id:", reassignRes);
  
  const afterState = await getState(adminToken);
  ld01 = afterState.state.leads.find(l => l.leadCode === 'LD-01');
  console.log("After reassignment LD-01 ownerId:", ld01.ownerId, "ownerCode:", ld01.ownerCode);
  
  console.log("\n=== Logging in as Ravi (U-01) ===");
  const raviToken = await login('ravi@lykaone.com', 'Ravi@1234');
  const raviLeads = await getLeads(raviToken);
  console.log("Ravi's leads count:", raviLeads.leads ? raviLeads.leads.length : 'undefined leads object');
  if(raviLeads.leads) console.log("Ravi's leads codes:", raviLeads.leads.map(l => l.leadCode));
  console.log("\n=== Testing Activity Creation for Ravi on LD-01 ===");
  const createActRes = await fetch(`${BASE_URL}/leads/${ld01.id}/activities`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${raviToken}` 
    },
    body: JSON.stringify({ type: 'call', message: 'Customer requested site visit tomorrow.' })
  });
  const actData = await createActRes.json();
  console.log("Activity creation response:", actData);
}

run().catch(console.error);
