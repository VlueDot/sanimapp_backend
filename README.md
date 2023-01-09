firebase deploy firebase.cmd deploy ﻿# Sanimapp Backend

## Initialize

- Login: firebase login
- Initialize: firebase init {database|firestore|others}
- init functions: firebase init functions

## Run

- Chose node version: nvm use 16.19.0
- if first time: 
  ```
  npm i firebase-tools -g
  npm i typescript -g
  npm i firebase-functions
  npm install --save firebase-functions@latest
  clear
  ```  
- Build: npm run build
- Emulate: npm run serve
- Shell: npm run shell
- fix code: .\node_modules\.bin\eslint.cmd src --fix  (modify in .eslintrc.js, in rules > "@typescript-eslint/no-var-requires": 0,)
- Deploy: firebase deploy --only functions

## Fork
- create a branch using this > https://trello.com/invite/b/Ku7GUi6c/ATTI03fe0e90f63625e30cd676f69a7c5494D35144F9/sanimapp
- create a branch from the last version of main using the ticket id and a abbrevation of your name. e.g. : Vincent > xvince
```
  git checkout main
  git pull origin main 
  git checkout -b task1-xvince
```
- when is finished and tested, vincent will merged it

## Final Commentary

DONT FUCKING WORK ON MAIN 

