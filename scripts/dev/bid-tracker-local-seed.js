// LOCAL TEST DATA ONLY — never ships, never touches a backend.
//
// Fills the in-memory/IndexedDB store of a running `npm run dev` tab (local mode,
// i.e. VITE_API_BASE_URL unset) with 8 departments, 40 opportunities, 30 bids and
// 3 custom columns, so the Bid Tracker Master Grid can be judged with real rows.
// The last 10 opportunities deliberately have no bid, for the Create Bid picker.
//
// Use: open http://localhost:<port>/bid-tracker in the dev build, open DevTools ->
// Console, paste this whole file, press Enter, wait for "seeded", then reload.
// It is a no-op if the store already has opportunities. It only works against the
// Vite dev server (it imports /src/... modules, which a production build doesn't serve).
(async () => {
  const { repository: r } = await import('/src/data/repository.ts')
  if ((await r.listOpportunities()).length) return console.log('not seeding: opportunities already exist')

  const depts = ['Ministry of Road Transport', 'Mumbai Municipal Corporation', 'Karnataka Police HQ', 'Delhi Jal Board', 'NHAI', 'Gujarat Revenue Dept', 'Tamil Nadu e-Gov Agency', 'Indian Railways CRIS']
  const states = [27, 27, 29, 7, 7, 24, 33, 7]
  const cities = ['Mumbai', 'Pune', 'Bengaluru', 'New Delhi', 'Gandhinagar', 'Chennai', 'Nagpur', 'Ahmedabad']
  const verticals = ['Smart City', 'Traffic', 'Surveillance', 'Water', 'Land Records', 'Health', 'Education', 'Railways']
  const titles = ['ITMS Command Centre', 'Body Worn Cameras Supply', 'E-Challan Integration', 'Land Records Digitisation', 'Smart Water Metering', 'Citizen Grievance Portal', 'Hospital Information System', 'CCTV Surveillance Phase II', 'Data Centre Managed Services', 'Fleet Tracking (VTS)', 'Toll Plaza ANPR', 'Drone Survey Services', 'GIS Mapping Platform', 'Call Centre 112 Upgrade', 'School ERP Rollout', 'Railway Passenger Info Displays']

  const nodes = []
  for (let i = 0; i < depts.length; i++) {
    nodes.push(await r.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: states[i], name: depts[i] }))
  }

  const opps = []
  for (let i = 0; i < 40; i++) {
    const d = i % depts.length
    const due = new Date(Date.now() + (((i * 5) % 70) - 10) * 86400000).toISOString().slice(0, 10)
    opps.push(await r.createOpportunity({
      departmentId: nodes[d].id,
      opportunityName: titles[i % titles.length] + (i >= titles.length ? ' - Lot ' + (Math.floor(i / titles.length) + 1) : ''),
      gemTenderId: 'GEM/2026/B/' + (6100000 + i * 137),
      city: cities[d], vertical: verticals[(i * 3) % verticals.length],
      submissionDate: due, publishDate: '2026-09-01', valueAmount: String(50 + i * 13), valueUnit: 'lakh',
    }))
  }

  const stages = ['solutioning', 'qualification', 'preBidQueries', 'commercialProposal', 'submitted']
  const bids = []
  for (let i = 0; i < 30; i++) {
    const bid = await r.createBid(opps[i].id)
    await r.updateBid(bid.id, { stageKey: stages[i % stages.length], tenderLink: i % 3 === 0 ? 'https://gem.gov.in/bid/' + i : null })
    bids.push(bid)
  }

  const emdPaid = await r.createBidCustomField({ name: 'EMD Paid', dataType: 'boolean' })
  const manager = await r.createBidCustomField({ name: 'Bid Manager', dataType: 'text' })
  const winProb = await r.createBidCustomField({ name: 'Win Probability', dataType: 'number' })
  const managers = ['Anita Rao', 'Vikram Shah', 'Priya Nair', 'Karan Mehta']
  for (let i = 0; i < 30; i++) {
    if (i % 2 === 0) await r.setBidCustomValue(bids[i].id, emdPaid.id, i % 4 === 0)
    await r.setBidCustomValue(bids[i].id, manager.id, managers[i % 4])
    if (i % 3) await r.setBidCustomValue(bids[i].id, winProb.id, 20 + ((i * 7) % 70))
  }
  console.log('seeded: 8 departments, 40 opportunities, 30 bids, 3 custom columns — reload the page')
})()
