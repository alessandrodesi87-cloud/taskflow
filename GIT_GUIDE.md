# 🔧 Git Guide - Per non tecnici

Non aver mai usato Git? Nessun problema. Segui questa guida step-by-step.

## Cosa è Git?

Git è un sistema che **traccia i cambiamenti al codice**. Immagina come Google Drive per il codice - salva ogni versione, chi ha fatto cosa, quando.

## Step 0: Installa Git

### Se usi Windows:
1. Vai a https://git-scm.com/download/win
2. Scarica l'installer
3. Installa (clicca next ovunque, di default va bene)
4. Apri CMD (Windowsa key + R, scrivi `cmd`)
5. Digita: `git --version` (se vedi un numero, è installato)

### Se usi Mac:
```bash
brew install git
git --version
```

### Se usi Linux:
```bash
sudo apt-get install git
git --version
```

## Step 1: Crea account GitHub (2 min)

GitHub è il "cloud" dove salvi il codice.

1. Vai a https://github.com
2. Clicca "Sign up"
3. Email, password, username
4. Conferma email
5. ✅ Fatto!

## Step 2: Crea un repository GitHub (3 min)

1. Vai a https://github.com/new
2. Riempi:
   - **Repository name**: `task-manager-gantt` (o nome che preferisci)
   - **Description**: "Team task manager with Gantt chart"
   - **Public** o **Private** (scegli tu)
3. Clicca "Create repository"
4. **COPIA l'URL che vedi** (es: `https://github.com/tuousername/task-manager-gantt.git`)

## Step 3: Configura Git (una volta sola)

Apri CMD/Terminal e digita:

```bash
git config --global user.name "Il tuo nome"
git config --global user.email "tua.email@derga.it"
```

Esempio:
```bash
git config --global user.name "Alessandro De Simone"
git config --global user.email "Alessandro.DeSimone@derga.it"
```

## Step 4: Scarica i file del progetto

Devi mettere i file (che hai nella cartella outputs) in una cartella di progetto.

```bash
# 1. Vai nella cartella dove vuoi il progetto
cd Desktop
# o
cd C:\Users\tuousername\Projects

# 2. Clona il repo (SOSTITUISCI l'URL con il tuo)
git clone https://github.com/tuousername/task-manager-gantt.git

# 3. Entra nella cartella
cd task-manager-gantt
```

**Cosa fa `git clone`?**
Scarica il repository da GitHub nel tuo computer.

## Step 5: Metti i file nel progetto

I file del progetto che hai (src/, package.json, ecc) **devono andare nella cartella task-manager-gantt**.

Copia tutti i file che hai in outputs → nella cartella task-manager-gantt.

Se stai su Windows Explorer:
```
C:\Users\tuousername\Projects\task-manager-gantt\
├── src/
├── supabase/
├── package.json
├── README.md
└── ...
```

## Step 6: Salva i file su GitHub (il "push")

Una volta copiati i file, salva tutto con questi comandi (sempre in CMD/Terminal):

```bash
# Vai nella cartella del progetto
cd task-manager-gantt

# 1. Dì a Git di tracciare tutti i file
git add .

# 2. Salva una "versione" (commit)
git commit -m "Initial commit - TaskFlow MVP"

# 3. Carica su GitHub
git push origin main
```

**Cosa fanno:**
- `git add .` = "traccia tutti i file"
- `git commit -m "..."` = "salva questa versione con un messaggio"
- `git push origin main` = "carica su GitHub"

Se tutto va bene, vedi: ✅ Done!

## Step 7: Verifica su GitHub

1. Vai a https://github.com/tuousername/task-manager-gantt
2. Vedi i file? ✅ Perfetto!

## Common errors

### Error: "not a git repository"
```
Significa che non sei nella cartella giusta.
Digita: cd task-manager-gantt
```

### Error: "fatal: unable to access 'https://github.com/...'"
```
GitHub non ti riconosce. Controlla:
1. Hai fatto git config con email corretta?
2. La password di GitHub è corretta?
3. Hai un internet connection?
```

### Error: "Please tell me who you are"
```
Devi fare git config prima (Step 3)
```

## Comandi utili da ricordare

```bash
# Vedi lo stato dei file
git status

# Vedi la cronologia dei cambiamenti
git log

# Se sbagli, annulla l'ultimo commit
git reset --soft HEAD~1

# Scarica i cambiamenti fatti da altri
git pull
```

## Workflow giornaliero

Ogni volta che fai cambiamenti:

```bash
# 1. Guarda che hai fatto
git status

# 2. Aggiungi i file
git add .

# 3. Salva la versione
git commit -m "Descrizione di cosa hai fatto"

# 4. Carica su GitHub
git push origin main
```

Esempio:
```bash
git commit -m "Aggiungo feature: email reminders"
git push origin main
```

## Prossimo step dopo Git

Una volta che hai fatto `git push`:

1. Vai a Vercel.com
2. Clicca "New Project"
3. Seleziona il repo da GitHub
4. Vercel fa il deploy automatico! 🚀

---

**Hai domande su Git?** Dimmi quale comando non capisci e te lo spiego meglio.
