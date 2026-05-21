#!/usr/bin/env node

/**
 * Pre-flight check script
 * Verifies all components are properly configured before running
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Running pre-flight checks...\n');

let errors = 0;
let warnings = 0;

// Check 1: Node version
console.log('1️⃣  Checking Node.js version...');
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
if (majorVersion >= 18) {
  console.log(`   ✅ Node.js ${nodeVersion} (OK)\n`);
} else {
  console.log(`   ❌ Node.js ${nodeVersion} (Need v18 or higher)\n`);
  errors++;
}

// Check 2: package.json exists
console.log('2️⃣  Checking package.json...');
if (fs.existsSync('package.json')) {
  console.log('   ✅ package.json found\n');
} else {
  console.log('   ❌ package.json not found\n');
  errors++;
}

// Check 3: node_modules exists
console.log('3️⃣  Checking dependencies...');
if (fs.existsSync('node_modules')) {
  console.log('   ✅ node_modules found\n');
} else {
  console.log('   ❌ node_modules not found. Run: npm install\n');
  errors++;
}

// Check 4: .env file exists
console.log('4️⃣  Checking environment configuration...');
if (fs.existsSync('.env')) {
  console.log('   ✅ .env file found');
  
  // Check if MONGODB_URI is set
  const envContent = fs.readFileSync('.env', 'utf8');
  if (envContent.includes('MONGODB_URI=') && !envContent.includes('MONGODB_URI=REPLACE_WITH')) {
    const uriLine = envContent.split('\n').find(line => line.startsWith('MONGODB_URI='));
    const uri = uriLine ? uriLine.split('=')[1].trim() : '';
    if (uri && uri.length > 10) {
      console.log('   ✅ MONGODB_URI is configured\n');
    } else {
      console.log('   ⚠️  MONGODB_URI appears to be empty\n');
      warnings++;
    }
  } else {
    console.log('   ⚠️  MONGODB_URI not configured. Update .env file\n');
    warnings++;
  }
} else {
  console.log('   ⚠️  .env file not found. Copy from .env.example\n');
  warnings++;
}

// Check 5: TypeScript source files
console.log('5️⃣  Checking source files...');
const requiredFiles = [
  'src/server.ts',
  'src/api/upload.ts',
  'src/api/jobs.ts',
  'src/analysis/engine.ts',
  'src/queue/imageQueue.ts',
  'src/db/connection.ts',
  'src/db/ImageJob.model.ts'
];

let missingFiles = [];
requiredFiles.forEach(file => {
  if (!fs.existsSync(file)) {
    missingFiles.push(file);
  }
});

if (missingFiles.length === 0) {
  console.log('   ✅ All source files present\n');
} else {
  console.log(`   ❌ Missing files: ${missingFiles.join(', ')}\n`);
  errors++;
}

// Check 6: Frontend files
console.log('6️⃣  Checking frontend...');
if (fs.existsSync('public/index.html')) {
  console.log('   ✅ Frontend dashboard found\n');
} else {
  console.log('   ❌ public/index.html not found\n');
  errors++;
}

// Check 7: Build output
console.log('7️⃣  Checking build output...');
if (fs.existsSync('dist/server.js')) {
  console.log('   ✅ Build output exists (dist/server.js)\n');
} else {
  console.log('   ⚠️  Build output not found. Run: npm run build\n');
  warnings++;
}

// Check 8: Required directories
console.log('8️⃣  Checking directories...');
const requiredDirs = ['uploads', 'logs'];
requiredDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`   ✅ Created ${dir}/ directory`);
  }
});
console.log('   ✅ All required directories exist\n');

// Check 9: TypeScript configuration
console.log('9️⃣  Checking TypeScript configuration...');
if (fs.existsSync('tsconfig.json')) {
  console.log('   ✅ tsconfig.json found\n');
} else {
  console.log('   ❌ tsconfig.json not found\n');
  errors++;
}

// Check 10: Test files
console.log('🔟 Checking test files...');
if (fs.existsSync('tests/api.test.js')) {
  console.log('   ✅ Test suite found\n');
} else {
  console.log('   ⚠️  tests/api.test.js not found\n');
  warnings++;
}

// Summary
console.log('═'.repeat(50));
console.log('📊 SUMMARY\n');

if (errors === 0 && warnings === 0) {
  console.log('✅ All checks passed! You\'re ready to go.\n');
  console.log('Next steps:');
  console.log('  1. Make sure MongoDB is running');
  console.log('  2. Run: npm run dev');
  console.log('  3. Open: http://localhost:3000\n');
  process.exit(0);
} else {
  if (errors > 0) {
    console.log(`❌ ${errors} error(s) found - must be fixed\n`);
  }
  if (warnings > 0) {
    console.log(`⚠️  ${warnings} warning(s) found - should be addressed\n`);
  }
  
  console.log('Action items:');
  if (!fs.existsSync('node_modules')) {
    console.log('  • Run: npm install');
  }
  if (!fs.existsSync('.env') || warnings > 0) {
    console.log('  • Copy .env.example to .env and configure MONGODB_URI');
  }
  if (!fs.existsSync('dist/server.js')) {
    console.log('  • Run: npm run build');
  }
  console.log('');
  
  process.exit(errors > 0 ? 1 : 0);
}
