const fs = require('fs');
const path = require('path');

function replacePathAliases(dir) {
  const files = fs.readdirSync(dir);
  let replacementCount = 0;
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      replacementCount += replacePathAliases(filePath);
    } else if (path.extname(file) === '.js') {
      let content = fs.readFileSync(filePath, 'utf8');
      const originalContent = content;
      
      content = content.replace(/require\("@\/([^"]+)"\)/g, (match, importPath) => {
        const currentDir = path.dirname(filePath);
        const targetPath = path.join(__dirname, '..', 'dist', importPath);
        const relativePath = path.relative(currentDir, targetPath).replace(/\\/g, '/');
        return `require("${relativePath.startsWith('.') ? relativePath : './' + relativePath}")`;
      });
      
      content = content.replace(/require\('@\/([^']+)'\)/g, (match, importPath) => {
        const currentDir = path.dirname(filePath);
        const targetPath = path.join(__dirname, '..', 'dist', importPath);
        const relativePath = path.relative(currentDir, targetPath).replace(/\\/g, '/');
        return `require('${relativePath.startsWith('.') ? relativePath : './' + relativePath}')`;
      });
      
      content = content.replace(/from ["']@\/([^"']+)["']/g, (match, importPath) => {
        const currentDir = path.dirname(filePath);
        const targetPath = path.join(__dirname, '..', 'dist', importPath);
        const relativePath = path.relative(currentDir, targetPath).replace(/\\/g, '/');
        const quote = match.includes('"') ? '"' : "'";
        return `from ${quote}${relativePath.startsWith('.') ? relativePath : './' + relativePath}${quote}`;
      });
      
      if (content !== originalContent) {
        fs.writeFileSync(filePath, content);
        const requireReplacements = (originalContent.match(/require\(["']@\/[^"']+["']\)/g) || []).length;
        const importReplacements = (originalContent.match(/from ["']@\/[^"']+["']/g) || []).length;
        const totalFileReplacements = requireReplacements + importReplacements;
        replacementCount += totalFileReplacements;
        console.log(`✓ Replaced ${totalFileReplacements} path alias(es) in ${path.relative(process.cwd(), filePath)}`);
      }
    }
  });
  
  return replacementCount;
}

const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  console.log('Replacing path aliases in compiled files...');
  const totalReplacements = replacePathAliases(distDir);
  console.log(`✅ Path alias replacement complete! Total replacements: ${totalReplacements}`);
} else {
  console.error('❌ dist directory not found');
  process.exit(1);
} 