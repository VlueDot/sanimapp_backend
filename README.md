firebase deploy firebase.cmd deploy ﻿# Sanimapp Backend

## Initialize

- Login: firebase login
- init functions: firebase init functions
- Initialize: firebase init {database|firestore|others}

## Run

- Chose node version: nvm use 16.19.0
- if first time run inside sanimapp_functions: 
  ```
  npm i firebase-tools -g
  npm i typescript -g
  npm i firebase-functions
  npm i -f
  npm install --save firebase-functions@latest
  npm audit fix --force
  clear
  ```  
- Build: npm run build
- Emulate: npm run serve
- but you can also: use npm run s  and just build
- to test with database: npm run s-db
- Shell: npm run shell
- fix code: npm run lint-fix
- Deploy: firebase deploy --only functions


## Fork
- create a branch from the last version of main using the ticket id and a abbrevation of your name. e.g. : Vincent > xvince
```
  git checkout main
  git pull origin main 
  git checkout -b {branch's name if needed}-{user} e.g. xvince, odoologin-xvince
```
- when is finished and tested, vincent will merged it

## Final Commentary

DONT FUCKING WORK ON MAIN 

