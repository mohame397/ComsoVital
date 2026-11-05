import {mkdir, writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {validatePublicConfig} from '../dist/cloud.js';
import {publicConfig} from '../dist/config.js';

const config = validatePublicConfig({
  supabaseUrl: process.env.COSMOVITAL_SUPABASE_URL ?? publicConfig.supabaseUrl ?? '',
  supabasePublishableKey: process.env.COSMOVITAL_SUPABASE_PUBLISHABLE_KEY ?? publicConfig.supabasePublishableKey ?? '',
  siteUrl: process.env.COSMOVITAL_SITE_URL ?? publicConfig.siteUrl ?? ''
});
await mkdir(new URL('../dist/vendor/', import.meta.url), {recursive:true});
await build({stdin:{contents:"export {createClient} from '@supabase/supabase-js';",resolveDir:process.cwd(),sourcefile:'supabase-vendor.js'},bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof',outfile:'dist/vendor/supabase.js'});
const publicValues={supabaseUrl:config.supabaseUrl,supabasePublishableKey:config.supabasePublishableKey,siteUrl:config.siteUrl};
await writeFile(new URL('../dist/config.js',import.meta.url),'// Public client configuration. Never include secret or service-role credentials.\nexport const publicConfig = Object.freeze('+JSON.stringify(publicValues,null,2)+');\nexport default publicConfig;\n');
console.log(config.enabled?'Static application built with public Supabase configuration.':'Static application built in explicit local mode; cloud accounts require Supabase setup.');
