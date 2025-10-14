const NEXTELLAR_LOGO = `                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                    :+                                                                                                                
                    :*##*-        .#%-                                                                                                                
                  :*%%##%%#:    :+%%#                                                                                                                 
                 .#%*:..:+=.  :*%%%%:    =*+     .++. =*+++++=  =++     **:.++++++++++++++++++= :*=       -*-          =++.    :+++++++=.             
                 #%+        .*@%#*%*     #%%+    .%%. *%%%%%%%= :%%=   *%* :%%%%%%%%%%%%%%%%%%* :@*       +%=         .%%%=    -%%%%%%%%%.            
                -%#.      :+%%#=.#%:     *%#%=   .%%. *%- .....  -%%: =%#:  ..:%* .. -%#......  :%*       +%=         =%+#%    -%#....:#%+            
                +%-      +%%#-. =%+      *%=%%-  .%%. *%:         -%#-%%:     :%*    :%#        :%*       +%=        .#%.+%=   -%#     =%+            
                *@.     :%%=   .#%-      *%--%#. .%%. *%=:-----    +%%%=      :%*    :%%------. :%*       +%=        :%* -%#   -%#.....#%:            
                *@. :+. *=.    =%*       *%- =%* .%%. *%%%%%%%%    :%%#.      :%*    :%%%%%%%%= :%*       +%=        #%:  #%-  -%#####%%=             
                +%+*%-  .     .#@.       *%-  +%*.#%. *%-......    *%%%*      :%*    :%#......  :%*       +%=       -%#++=*%*  -%#====*%#.            
                =%%%#         -%+        *%-  .#%+#%. *%:         =%%=%%=     :%*    :%#.       :%*       +%=       #%%%%%%%%: -%#     #%-            
              :+#%#=.        .%%.        *%-   .#%%%. *%-......  -%%- +%%-    :%*    :%#....... :%*.....: +%+..... :%%:....+%* -%#     +@-            
            :*%%#-           +%+         *%-    :%%%. *%%%%%%%= :%%=   #%#.   :%#    :%%%%%%%%#.:%%%%%%%%.+%%%%%%% +%*     .%%.-%#     +@=            
            :*%%#-.         .%%:         =+:     -++. =++++++=  =++     *+=   .*=    .++++++++= :++++++++ -+++++++ +*.      =*-:++     :*=            
              :+%%#=        +%+                                                                                                                       
                .#@%%=     .#%.                                                                                                                       
                  :*#%#-   =%=                                                                                                                        
                    ::::   ::                                                                                                                         
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
                                                                                                                                                      
`;

const frames = ['[●       ]', '[ ●      ]', '[  ●     ]', '[   ●    ]', '[    ●   ]', '[     ●  ]', '[      ● ]', '[       ●]'];

export async function displaySuccess(appName: string): Promise<void> {
  if (!process.stdout.isTTY || process.env.CI) {
    console.log('');
    console.log('✅ Nextellar scaffold complete!');
    console.log(`To get started:`);
    console.log(`  cd ${appName}`);
    console.log('  npm run dev');
    console.log('');
    return;
  }

  console.log('');
  
  for (let i = 0; i < 16; i++) {
    process.stdout.write(`\r${frames[i % frames.length]} Finalizing setup...`);
    await new Promise(r => setTimeout(r, 100));
  }

  process.stdout.write('\r\x1b[K');
  console.log(NEXTELLAR_LOGO);
  console.log('✅ Nextellar scaffold complete!');
  console.log('');
  console.log('Next steps:');
  console.log(`  cd ${appName}`);
  console.log('  npm run dev');
  console.log('');
}

export function startProgress() {
  if (!process.stdout.isTTY || process.env.CI) return null;

  let i = 0;
  const timer = setInterval(() => {
    process.stdout.write(`\r${frames[i % frames.length]} Installing dependencies...`);
    i++;
  }, 120);

  return () => {
    clearInterval(timer);
    process.stdout.write('\r\x1b[K');
  };
}