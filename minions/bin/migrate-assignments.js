#!/usr/bin/env node
/**
 * Migration script to convert ASSIGNMENTS.md to assignments.json
 * 
 * Usage: node minions/bin/migrate-assignments.js
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../..');
const ASSIGNMENTS_MD = path.join(REPO_ROOT, 'minions/ASSIGNMENTS.md');
const ASSIGNMENTS_JSON = path.join(REPO_ROOT, 'minions/assignments.json');

function parseMarkdownTable(content) {
  const lines = content.split('\n');
  const assignments = [];
  
  // Find the "Current Assignments" table
  let inCurrentAssignments = false;
  let headerFound = false;
  
  for (const line of lines) {
    if (line.includes('## Current Assignments')) {
      inCurrentAssignments = true;
      continue;
    }
    
    if (inCurrentAssignments && line.includes('## ')) {
      // Hit next section
      break;
    }
    
    if (inCurrentAssignments && line.startsWith('|')) {
      if (!headerFound) {
        // Skip header and separator
        if (line.includes('Agent') && line.includes('Branch')) {
          headerFound = true;
        }
        continue;
      }
      
      if (line.includes('---')) {
        continue;
      }
      
      // Parse data row
      const parts = line.split('|').map(p => p.trim()).filter(p => p);
      
      if (parts.length >= 4 && parts[0] !== '-') {
        const [agent, branch, feature, status, specFile] = parts;
        
        if (agent && agent !== '-') {
          assignments.push({
            id: `${agent}-${Date.now()}-${assignments.length}`,
            agentId: agent,
            branch: branch || `feature/${agent}/unknown`,
            feature: feature || 'Unknown Feature',
            status: status.toLowerCase().replace(/\s+/g, '_') || 'pending',
            specFile: specFile || `minions/assignments/${agent}-feature.md`,
            tool: 'claude',
            mode: 'idle'
          });
        }
      }
    }
  }
  
  return assignments;
}

function migrate() {
  console.log('🔄 Migrating ASSIGNMENTS.md to assignments.json...\n');
  
  // Check if JSON already exists
  if (fs.existsSync(ASSIGNMENTS_JSON)) {
    console.log('⚠️  assignments.json already exists!');
    const data = JSON.parse(fs.readFileSync(ASSIGNMENTS_JSON, 'utf-8'));
    console.log(`   Found ${data.assignments.length} existing assignments.`);
    console.log('   Skipping migration. Delete assignments.json to re-migrate.\n');
    return;
  }
  
  // Check if MD exists
  if (!fs.existsSync(ASSIGNMENTS_MD)) {
    console.log('ℹ️  ASSIGNMENTS.md not found. Creating empty assignments.json...\n');
    const emptyData = {
      assignments: [],
      availableAgentIds: ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5']
    };
    fs.writeFileSync(ASSIGNMENTS_JSON, JSON.stringify(emptyData, null, 2));
    console.log('✅ Created empty assignments.json\n');
    return;
  }
  
  // Parse the markdown
  const content = fs.readFileSync(ASSIGNMENTS_MD, 'utf-8');
  const assignments = parseMarkdownTable(content);
  
  console.log(`📋 Found ${assignments.length} assignments in ASSIGNMENTS.md`);
  
  // Create JSON structure
  const data = {
    assignments,
    availableAgentIds: ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5']
  };
  
  // Write JSON file
  fs.writeFileSync(ASSIGNMENTS_JSON, JSON.stringify(data, null, 2));
  
  console.log(`✅ Successfully created assignments.json`);
  console.log(`   ${assignments.length} assignments migrated\n`);
  
  if (assignments.length > 0) {
    console.log('📋 Migrated assignments:');
    assignments.forEach(a => {
      console.log(`   - ${a.agentId}: ${a.feature}`);
    });
    console.log();
  }
}

migrate();

