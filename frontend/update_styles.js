const fs = require('fs');
let content = fs.readFileSync('app/dashboard/tasks/page.tsx', 'utf8');

// 1. Column wrappers
content = content.replace(
    /className="flex-1 flex flex-col gap-3 min-h-\[600px\] min-w-\[320px\] bg-\[#292524\] rounded-\[16px\]/g,
    'className="flex-1 flex flex-col gap-3 min-h-[600px] min-w-[320px] bg-transparent border-x border-[#222222] rounded-xl'
);

// 2. Task Cards
content = content.replace(
    /className={`bg-\[#44403C\] rounded-\[12px\] border border-\[#57534E\] shadow-\[0_8px_16px_rgba\(0,0,0,0\.5\)\] p-4 hover:brightness-110 transition-all cursor-pointer relative group \${draggedTaskId === task\.id \? 'opacity-50 ring-2 ring-\[#D6D3D1\] scale-\[0\.98\]' : ''}`}/g,
    'className={`bg-[#1E1E1E] rounded-lg border border-white/10 shadow-[0_4px_6px_rgba(0,0,0,0.3)] p-4 hover:bg-[#242424] hover:border-white/20 transition-all cursor-pointer relative group ${draggedTaskId === task.id ? \'opacity-50 ring-2 ring-[#78716C] scale-[0.98]\' : \'\'}`}'
);

content = content.replace(
    /className={`bg-\[#44403C\] rounded-\[12px\] border border-\[#57534E\] shadow-\[0_8px_16px_rgba\(0,0,0,0\.5\)\] p-4 hover:brightness-110 transition-all cursor-pointer relative group opacity-70 \${draggedTaskId === task\.id \? 'opacity-50 ring-2 ring-\[#D6D3D1\] scale-\[0\.98\]' : ''}`}/g,
    'className={`bg-[#1E1E1E] rounded-lg border border-white/10 shadow-[0_4px_6px_rgba(0,0,0,0.3)] p-4 hover:bg-[#242424] hover:border-white/20 transition-all cursor-pointer relative group opacity-70 ${draggedTaskId === task.id ? \'opacity-50 ring-2 ring-[#78716C] scale-[0.98]\' : \'\'}`}'
);

content = content.replace(
    /className={`bg-\[#292524\] rounded-\[12px\] border border-\[#44403C\] shadow-\[0_8px_16px_rgba\(0,0,0,0\.5\)\] p-4 hover:brightness-110 transition-all cursor-pointer relative group opacity-50 \${draggedTaskId === task\.id \? 'opacity-50 ring-2 ring-\[#D6D3D1\] scale-\[0\.98\]' : ''}`}/g,
    'className={`bg-[#1E1E1E] rounded-lg border border-white/10 shadow-[0_4px_6px_rgba(0,0,0,0.3)] p-4 hover:bg-[#242424] hover:border-white/20 transition-all cursor-pointer relative group opacity-50 ${draggedTaskId === task.id ? \'opacity-50 ring-2 ring-[#78716C] scale-[0.98]\' : \'\'}`}'
);

// 3. Matter progress bar
// It was <div className="w-full bg-[#1E1E1E] h-1 rounded-full overflow-hidden">
// But wait! Right now in the view_file from earlier, I saw:
// <div className="w-full bg-[#1E1E1E] h-1 rounded-full overflow-hidden">
// Let's replace whatever it currently is:
content = content.replace(
    /<div className="w-full bg-\[\#.*?\] h-1 rounded-full overflow-hidden">/g,
    '<div className="w-full bg-[#1E1E1E] h-1 rounded-full overflow-hidden">'
);
content = content.replace(
    /<div className="w-full bg-white\/5 h-1 rounded-full overflow-hidden">/g,
    '<div className="w-full bg-[#1E1E1E] h-1 rounded-full overflow-hidden">'
);

fs.writeFileSync('app/dashboard/tasks/page.tsx', content);
console.log("Updated styles.");
