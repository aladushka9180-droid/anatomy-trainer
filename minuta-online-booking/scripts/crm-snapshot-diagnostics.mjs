import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function safeDiagnostics(log) {
  const out=[];
  for(const line of log.split(/\r?\n/)){
    const error=line.match(/^psql:\/tmp\/([a-z-]+)\.sql:(\d+): ERROR: +([0-9A-Z]{5})(?::|$)/);
    if(error)out.push(`phase=${error[1]} line=${error[2]} SQLSTATE=${error[3]}`);
    const detail=line.match(/^DETAIL: +(\{.*\})$/);
    if(detail){
      try{
        const value=JSON.parse(detail[1]);
        if(!/^(requires_postgresql_17|forbidden_managed_schema_loaded|unsupported_data_relation|category_policy_missing|unexpected_category_value|auth_uuid_placeholder_missing|auth_users_must_contain_only_uuid_id|unexpected_auth_data_table|required_tables_missing|required_columns_missing|unknown_sensitive_columns|unknown_fk_dependency|unexpected_outbound_or_secret_function|uuid_collision|foreign_key_integrity_failed|trigger_state_restore_failed)$/.test(value.code))continue;
        out.push(`guard=${value.code}`);
        if(Array.isArray(value.objects))for(const item of value.objects){
          if(typeof item==='string'&&item.length<=250&&/^[a-z_][a-z0-9_.(), >\[\]-]*$/i.test(item))out.push(`object=${item}`);
        }
      }catch{/* Raw diagnostic text is deliberately discarded. */}
    }
    if(error){
      const constraint=line.match(/violates (?:check|foreign key|unique) constraint "([a-z_][a-z0-9_]*)"/i);
      if(constraint)out.push(`constraint=${constraint[1]}`);
    }
  }
  return out.join('\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  console.error(safeDiagnostics(readFileSync(process.argv[2],'utf8')));
}
