# Sanimapp Backend

## Initialize

- Login: firebase login
- init functions: firebase init functions
- Initialize: firebase init {database|firestore|others}

## Run

- Chose node version: nvm use 16.19.0
- if first time run inside sanimapp_functions: 
  ```
  npm i
  npm i firebase-tools -g
  npm i typescript -g
  npm i firebase-functions
  npm i @types/node-fetch
  npm install --save firebase-functions@latest
  npm audit fix --force
  clear
  ```  
- REMEMBER TO RUN OUTSIDE sanimapp_function folder: 
``` 
firebase.cmd login
firebase.cmd use dev
``` 
- Test inside sanimapp_function 
``` 
  npm run build
  npm run s
``` 
- Test: http://127.0.0.1:5001/sanimappdev/us-central1/test

# USE
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

## Merge
- First run lint in your branch
```
  npm run lint-fix
```
- Thereafter, push your changes. 
- Change to main, pull last changes from origin main
```
  git checkout main
  git pull origin main 
```
- merge and solve conflicts if there any. git merge {branch to be merged}

- Test and push the merge
```
  git push origin main 
```

## Final Commentary

DONT FUCKING WORK ON MAIN 

