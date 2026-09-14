import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const migration = readFileSync(new URL('../supabase-migration-v161.sql', import.meta.url), 'utf8').replace(/\r/g, '');
const tableStarts=[...migration.matchAll(/create table if not exists public\.([a-z0-9_]+_v161)\(/g)];
const tableColumns=match=>{let depth=1,end=match.index+match[0].length;
  for(;end<migration.length&&depth;end+=1){if(migration[end]==='(')depth+=1;else if(migration[end]===')')depth-=1;}
  const body=migration.slice(match.index+match[0].length,end-1);let part='',level=0,parts=[];
  for(const char of body){if(char==='(')level+=1;if(char===')')level-=1;if(char===','&&level===0){parts.push(part);part='';}else part+=char;}parts.push(part);
  return parts.map(value=>value.trim()).filter(value=>!/^(check|unique|primary|constraint|foreign)\b/i.test(value))
    .map(value=>value.match(/^([a-z0-9_]+)/i)?.[1]).filter(Boolean);
};
const tables=tableStarts.map(match=>({name:match[1],columns:tableColumns(match)})).sort((a,b)=>a.name.localeCompare(b.name));
const granted=new Map();
for(const match of migration.matchAll(/grant execute on function public\.([a-z0-9_]+_v161)\([^;]+?\)\s+to\s+([^;]+);/g))
  granted.set(match[1],new Set(match[2].split(',').map(role=>role.trim())));
const functions=[...migration.matchAll(/create or replace function public\.([a-z0-9_]+_v161)\s*\([\s\S]*?\)\s*returns[\s\S]*?\bas \$\$([\s\S]*?)\$\$;/g)]
  .map(match=>{const roles=granted.get(match[1])||new Set();return {name:match[1],
    sourceHash:createHash('sha256').update(match[2]).digest('hex'),marker:'minuta_message_center_v161',owner:'postgres',
    access:{public:false,anon:roles.has('anon'),authenticated:roles.has('authenticated'),service_role:roles.has('service_role')}};})
  .sort((a,b)=>a.name.localeCompare(b.name));
const sourceSha256 = createHash('sha256').update(migration).digest('hex');
process.stdout.write(JSON.stringify({version:'v161',tables,functions,sourceSha256,disabledByDefault:true,
  directBrowserTableAccess:false,mediaAvailable:false,transcriptionAvailable:false}));
