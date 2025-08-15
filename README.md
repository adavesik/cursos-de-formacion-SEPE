# SEPE Cursos

Welcome to **SEPE Cursos**! This easy-to-use web app helps you explore and manage course data from SEPE (Servicio Público de Empleo Estatal). Whether you want to find training courses in Spain, filter by location or date, or export data for reports, this app makes it simple.

## What is this about?

With SEPE Cursos, you can:
- **Load course data**: Upload Excel or CSV files or fetch data from a web link.
- **Filter courses**: Search by city, course type, dates, or keywords.
- **Sort courses**: Organize courses by code, name, start date, or other fields.
- **View charts**: See a bar chart of course categories (e.g., IT, Healthcare).
- **Fetch course levels**: Get official SEPE course levels (e.g., Level 1, 2, 3) using an API.
- **Export data**: Save filtered courses as a CSV file.

## How to Access

You can use SEPE Cursos in two ways:
- **Online**: Visit https://cursosformacionsepe.vercel.app
- **Locally**: Run the app on your computer by following the setup steps below.

## Getting Started

### Option 1: Use the Online Version
1. Go to https://cursosformacionsepe.vercel.app
2. Upload a file or enter a data feed URL (e.g., `/madrid_cursos.xlsx`).
3. Start filtering, sorting, or exporting courses!

### Option 2: Run Locally
To run the app on your computer:
1. **Install Node.js**: Download it from [nodejs.org](https://nodejs.org) (choose the "LTS" version).
2. **Get the Code**:
```bash
   git clone https://github.com/your-username/sepe-cursos.git
   cd sepe-cursos
```
3. **Install Dependencies:**
```bash
npm install
```
4. **Start the App:**
```bash
npm start
```

## How to Use
### Load Data
- Click "Importar Excel/CSV" to upload an Excel or CSV file.
- Or, type a URL (e.g., /madrid_cursos.xlsx) in the "URL del feed" field and click "Cargar feed".

###Filter Courses
- Choose cities, course types, or date ranges in the filter panel.
- Check "Solo próximos" to see only upcoming courses.
- Type in the search bar to find courses by name, center, or other details.

###Sort Courses
- Click table headers (e.g., "Código", "Inicio") to sort the list.

###Fetch Course Levels
- Enter your API URL (e.g., https://nivel-api.yourname.workers.dev) in the "API base" field.
- Select courses with checkboxes, then click "Fetch Nivel (SEPE)" to get course levels.

###Export Data
- Click "Export CSV (filtrado)" to download filtered courses as a CSV file.

##Demo
Try the app live at https://cursosformacionsepe.vercel.app