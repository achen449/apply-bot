export const blockedResearchDomains = [
  'europages.',
  'chemeurope.',
  'marketsandmarkets.',
  'assetphysics.',
  'modoenergy.',
  'pfnexus.',
  'plugsocketmuseum.',
  'northern-connectors.',
  'marinehowto.',
  'pvel.',
  'engx.theiet.org',
  'ensun.io',
  'energy-storage.news',
  'solarenergyevents.com',
  'gtai.de',
  'eu-startups.com',
  'solarfeeds.com',
  'whcsolar.com',
  'hiitio.com'
]

export const industryProfiles = {
  'industrial connectors': {
    label: 'Industrial Connectors',
    description: 'Connector suppliers for harsh-environment power, signal, and data transmission.',
    upstreamIndustries: ['solar', 'energy storage', 'ev charging', 'industrial automation', 'rail transit'],
    searchTerms: ['mc4 connector', 'battery connector', 'hv connector', 'circular connector', 'wire harness'],
    targetRoles: ['Procurement Manager', 'Sourcing Manager', 'R&D Manager', 'Product Development Manager', 'Supply Chain Director'],
    emailAngles: ['dual-source connector platform', 'faster custom cable harness development', 'high-current connector validation support'],
    companySeeds: {
      solar: ['Sungrow', 'Trina Solar', 'LONGi', 'JA Solar', 'Canadian Solar', 'First Solar'],
      'energy storage': ['Fluence', 'Tesla Energy', 'BYD Energy Storage', 'Sungrow', 'Enphase', 'Powin'],
      'ev charging': ['ABB E-mobility', 'ChargePoint', 'Wallbox', 'Tritium', 'Autel Energy', 'Delta Electronics'],
      'industrial automation': ['Siemens', 'Schneider Electric', 'Phoenix Contact', 'Bosch Rexroth', 'Mitsubishi Electric', 'Rockwell Automation'],
      'rail transit': ['CRRC', 'Alstom', 'Siemens Mobility', 'Hitachi Rail', 'Stadler', 'CAF']
    }
  },
  solar: {
    label: 'Solar',
    description: 'Manufacturers and integrators across PV modules, inverters, and BOS equipment.',
    upstreamIndustries: ['pv modules', 'inverters', 'solar trackers', 'epc', 'balance of system'],
    searchTerms: ['solar inverter', 'pv module', 'combiner box', 'tracker system', 'junction box'],
    targetRoles: ['Strategic Sourcing Manager', 'Supplier Quality Engineer', 'Procurement Director', 'Electrical R&D Manager'],
    emailAngles: ['BOS component localization', 'qualified second-source for PV electrical parts', 'shorter lead times for solar projects'],
    companySeeds: {
      'pv modules': ['LONGi', 'JinkoSolar', 'Trina Solar', 'JA Solar', 'Canadian Solar', 'First Solar'],
      inverters: ['Sungrow', 'Huawei Digital Power', 'SolarEdge', 'Growatt', 'GoodWe', 'SMA Solar'],
      'solar trackers': ['Nextracker', 'Array Technologies', 'GameChange Solar', 'Arctech Solar', 'FTC Solar', 'PV Hardware'],
      epc: ['Sterling and Wilson', 'Bechtel', 'PowerChina', 'Black & Veatch', 'Moss', 'Mahindra Susten'],
      'balance of system': ['Shoals Technologies', 'Staubli', 'BizLink', 'Amphenol', 'TE Connectivity', 'Phoenix Contact']
    }
  },
  'energy storage': {
    label: 'Energy Storage',
    description: 'Grid-scale and commercial battery storage developers, pack assemblers, and integrators.',
    upstreamIndustries: ['battery packs', 'pcs integrators', 'ems platforms', 'battery enclosures', 'system integration'],
    searchTerms: ['battery storage system', 'bess integrator', 'pcs', 'battery pack', 'containerized storage'],
    targetRoles: ['Commodity Manager', 'Pack Engineering Manager', 'Procurement Lead', 'Supplier Development Engineer'],
    emailAngles: ['high-voltage interconnect sourcing', 'battery pack platform support', 'storage system component risk reduction'],
    companySeeds: {
      'battery packs': ['BYD', 'CATL', 'EVE Energy', 'LG Energy Solution', 'Samsung SDI', 'REPT Battero'],
      'pcs integrators': ['Sungrow', 'Fluence', 'Sineng Electric', 'Delta Electronics', 'TMEIC', 'NR Electric'],
      'ems platforms': ['Stem', 'Fluence', 'Wartsila', 'Autogrid', 'Tesla Energy', 'GridBeyond'],
      'battery enclosures': ['TLS Offshore Containers', 'Legrand Starline', 'Eaton', 'Schneider Electric', 'Vertiv', 'Rittal'],
      'system integration': ['Powin', 'Tesla Energy', 'Fluence', 'Wartsila', 'Sungrow', 'Hitachi Energy']
    }
  },
  'ev charging': {
    label: 'EV Charging',
    description: 'Charge point operators, charger OEMs, fleet charging providers, and EV charging platform companies.',
    upstreamIndustries: ['charging operators', 'charger manufacturers', 'fleet charging', 'charging software', 'dc fast charging'],
    searchTerms: ['ev charging', 'charging station', 'dc fast charging', 'charge point operator', 'charging network'],
    targetRoles: ['Category Buyer', 'Procurement Manager', 'Charging Infrastructure Manager', 'Hardware Sourcing Manager'],
    emailAngles: ['connector and harness support for charging hardware', 'faster sourcing for charging station builds', 'second-source support for EV charging assemblies'],
    companySeeds: {
      'charging operators': ['Allego', 'IONITY', 'EnBW', 'Fastned', 'Shell Recharge', 'ChargePoint'],
      'charger manufacturers': ['ABB E-mobility', 'Wallbox', 'Tritium', 'Autel Energy', 'Alpitronic', 'Kempower'],
      'fleet charging': ['bp pulse', 'Siemens eMobility', 'Schneider Electric', 'Heliox', 'ChargePoint', 'Ekoenergetyka'],
      'charging software': ['has.to.be', 'chargecloud', 'Driivz', 'Monta', 'Virta', 'Ampcontrol'],
      'dc fast charging': ['Alpitronic', 'Kempower', 'ABB E-mobility', 'Tritium', 'Delta Electronics', 'Ekoenergetyka']
    }
  },
  'industrial automation': {
    label: 'Industrial Automation',
    description: 'OEMs and subsystem makers for controls, robotics, sensors, and power distribution.',
    upstreamIndustries: ['robotics', 'factory controls', 'motion systems', 'sensor platforms', 'panel builders'],
    searchTerms: ['industrial control cabinet', 'robotics oem', 'motion control', 'sensor manufacturer', 'panel builder'],
    targetRoles: ['Category Buyer', 'Electronics R&D Manager', 'NPI Sourcing Manager', 'Technical Purchasing Lead'],
    emailAngles: ['connector standardization for control cabinets', 'faster NPI sampling for automation OEMs', 'cost-down on industrial cable assemblies'],
    companySeeds: {
      robotics: ['ABB Robotics', 'FANUC', 'Yaskawa', 'KUKA', 'Universal Robots', 'Estun'],
      'factory controls': ['Siemens', 'Schneider Electric', 'Mitsubishi Electric', 'Omron', 'Rockwell Automation', 'Delta Electronics'],
      'motion systems': ['Bosch Rexroth', 'Parker Hannifin', 'Beckhoff', 'Lenze', 'B and R', 'SANYO DENKI'],
      'sensor platforms': ['SICK', 'KEYENCE', 'Pepperl+Fuchs', 'Balluff', 'ifm', 'Turck'],
      'panel builders': ['Rittal', 'Eplan', 'nVent Hoffman', 'Eaton', 'Schneider Electric', 'Legrand']
    }
  }
}

export const countryMarketHints = {
  germany: ['industrial automation', 'solar', 'energy storage'],
  usa: ['energy storage', 'solar', 'industrial automation'],
  china: ['solar', 'energy storage', 'industrial connectors'],
  japan: ['industrial automation', 'energy storage'],
  india: ['solar', 'energy storage', 'industrial automation'],
  france: ['rail transit', 'energy storage', 'industrial automation'],
  uk: ['energy storage', 'industrial automation', 'ev charging']
}
