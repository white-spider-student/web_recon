#!/usr/bin/env node
const sqlite3 = require('sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(dbPath);
const allAsync = (sql, params=[]) => new Promise((res, rej) => db.all(sql, params, (e, r) => e ? rej(e) : res(r)));
const runAsync = (sql, params=[]) => new Promise((res, rej) => db.run(sql, params, function(e){ if(e) rej(e); else res(this); }));

async function dedupe() {
  // Find duplicate groups
  const groups = await allAsync("SELECT website_id, value, COUNT(*) as cnt FROM nodes GROUP BY website_id, value HAVING cnt > 1");
  if (!groups || groups.length === 0) {
    console.log('No duplicate node groups found.');
    return;
  }

  await runAsync('BEGIN TRANSACTION');
  try {
    for (const g of groups) {
      const { website_id, value } = g;
      const rows = await allAsync('SELECT id FROM nodes WHERE website_id IS ? AND value = ? ORDER BY id ASC', [website_id, value]);
      if (!rows || rows.length < 2) continue;

      // Choose canonical id: prefer the node with the most headers
      const counts = await Promise.all(rows.map(r => allAsync('SELECT COUNT(*) as c FROM node_headers WHERE node_id = ?', [r.id]).then(x=>x[0].c).catch(()=>0)));
      let bestIndex = 0;
      for (let i=1;i<counts.length;i++) if ((counts[i]||0) > (counts[bestIndex]||0)) bestIndex = i;
      const canonical = rows[bestIndex].id;
      const duplicates = rows.filter(r => r.id !== canonical).map(r => r.id);

      console.log(`Merging ${duplicates.length} duplicates for website_id=${website_id} value=${value} into id=${canonical}`);

      // Merge node meta fields: prefer canonical values, otherwise take from duplicates in order
      const metaCols = ['ip','response_time_ms','title','ports','tls_cert','dirsearch_count','wappalyzer','details','status','size'];
      const nodeVals = await allAsync(`SELECT id, ${metaCols.join(', ')} FROM nodes WHERE id IN (${rows.map(r=>r.id).join(',')})`);
      const merged = {};
      for (const col of metaCols) merged[col] = null;
      // prefer canonical first, then others
      const ordered = [canonical].concat(duplicates);
      for (const id of ordered) {
        const row = nodeVals.find(x => x.id === id) || {};
        for (const col of metaCols) {
          if (merged[col] == null && row[col] != null) merged[col] = row[col];
        }
      }

      // Update canonical
      const setClauses = [];
      const setVals = [];
      for (const col of metaCols) {
        if (merged[col] !== null && merged[col] !== undefined) {
          setClauses.push(`${col} = ?`);
          setVals.push(merged[col]);
        }
      }
      if (setClauses.length > 0) {
        await runAsync(`UPDATE nodes SET ${setClauses.join(', ')} WHERE id = ?`, setVals.concat([canonical]));
      }

      // Reassign child rows
      await runAsync(`UPDATE node_headers SET node_id = ? WHERE node_id IN (${duplicates.map(()=>'?').join(',')})`, [canonical].concat(duplicates)).catch(()=>{});
      await runAsync(`UPDATE node_technologies SET node_id = ? WHERE node_id IN (${duplicates.map(()=>'?').join(',')})`, [canonical].concat(duplicates)).catch(()=>{});

      // Update relationships: source or target
      for (const d of duplicates) {
        await runAsync('UPDATE node_relationships SET source_node_id = ? WHERE source_node_id = ?', [canonical, d]).catch(()=>{});
        await runAsync('UPDATE node_relationships SET target_node_id = ? WHERE target_node_id = ?', [canonical, d]).catch(()=>{});
      }

      // Remove duplicate relationships that are now exact duplicates (keep the lowest id)
      await runAsync(`DELETE FROM node_relationships WHERE id NOT IN (SELECT MIN(id) FROM node_relationships GROUP BY source_node_id, target_node_id, relationship_type)`).catch(()=>{});

      // Delete duplicate node rows
      await runAsync(`DELETE FROM nodes WHERE id IN (${duplicates.map(()=>'?').join(',')})`, duplicates).catch(()=>{});
    }

    await runAsync('COMMIT');
    console.log('Dedupe completed.');
  } catch (e) {
    await runAsync('ROLLBACK').catch(()=>{});
    throw e;
  }
}

(async ()=>{
  try {
    await dedupe();
  } catch (e) {
    console.error('Dedupe failed:', e && e.message ? e.message : e);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();
