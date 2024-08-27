import express from 'express'
import mysql from 'mysql2'
import cookieParser from 'cookie-parser'
import { hash } from './utils/hash.js'
import { userSchema } from './utils/zod.js'
import cors from 'cors'
import dbCheck from './utils/dbCheck.js'

const { PORT, DB_HOST, DB_USER, DB_PASSWORD, DB_DATABASE, DB_PORT } = process.env

const db = mysql.createPool({ // **Cambio: Creación de pool de conexiones en lugar de base de datos SQLite**
  host: DB_HOST ?? 'wvk.h.filess.io', // Cambia esto según tu configuración
  user: DB_USER ?? 'investigacion_questionus', // Cambia esto según tu configuración
  password: DB_PASSWORD ?? '5274ae2fcd1b4273eed318741f76e43befe3e9a2', // Cambia esto según tu configuración
  database: DB_DATABASE ?? 'investigacion_questionus', // Cambia esto según tu configuración
  port: DB_PORT ?? '3307'
})
// [FRONTEND_URL, 'http://localhost:5173', 'wvk.h.filess.io', 'https://lectura-vs-conocimiento.vercel.app']
const app = express()
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(express.json())
app.use(cookieParser())

app.post('/mail', async (req, res) => {
  const { email } = req.body
  const age = parseInt(req.body.age)

  // Validar los datos
  if (!userSchema.safeParse({ email, age }).success) {
    return res.status(400).json({
      email: userSchema.shape.email.safeParse(email).success,
      age: userSchema.shape.age.safeParse(age).success
    })
  }
  const hashedEmail = hash(email)
  // Uso del pool de conexiones
  dbCheck({ res, newUser: true, age, hashedEmail, db })
    .then((result) => {
      if (result.msg) return res.status(result.status).send(result.msg)
      if (result.jn) return res.status(result.status).json(result.jn)
      if (!result.result && result.result !== 0) return
      res.status(201).json({ id: result.result })
    }).catch(err => {
      if (err.msg) return res.status(err.status).send(err.msg)
      if (err.jn) return res.status(err.status).json(err.jn)
    })
})
app.post('/survey', async (req, res) => {
  if (!req.body?.id) return res.status(409).json({ redirect: '/' })
  try {
    const dbCheckRes = await dbCheck({ res, checkSurvey: true, db, id: req.body.id })
    if (dbCheckRes.msg) return res.status(dbCheckRes.status).send(dbCheckRes.msg)
    if (dbCheckRes.jn) return res.status(dbCheckRes.status).json(dbCheckRes.jn)
    if (!dbCheckRes.result && dbCheckRes.result !== false) return

    db.getConnection((err, connection) => { // **Cambio: Obtención de conexión del pool**
      if (err) {
        console.error(err.message)
        return res.status(500).send('Failed while connecting to the database')
      }

      connection.query('SELECT question_id, question_text, response_type, option_1, option_2, option_3, option_4 FROM Survey_Questions', (err, rows) => { // **Cambio: Uso de query en lugar de all**
        if (err) {
          console.error(err.message)
          connection.release()
          return res.status(500).send('Failed while getting survey')
        }

        connection.release()
        res.status(200).send(rows.map(row => ({
          question_id: row.question_id,
          question_text: row.question_text,
          response_type: row.response_type,
          options: [row.option_1, row.option_2, row.option_3, row.option_4]
        })))
      })
    })
  } catch (err) {
    if (err.msg) return res.status(err.status).send(err.msg)
    if (err.jn) return res.status(err.status).json(err.jn)
  }
})
app.post('/survey/send', async (req, res) => {
  if (!req.body?.id) return res.status(409).json({ redirect: '/' })

  if (req.body.survey && !Array.isArray(req.body.survey)) return res.status(400).send('Missing survey')
  const query = req.body.survey.map(ans => '(?, ?, ?)').join(', ')
  const values = req.body.survey.map(ans => [ans.question_id, req.body.id, ans.response]).flat()
  if (req.body.survey.filter(i => i.question_id !== undefined && i.response !== undefined).length < req.body.length) return res.status(400).send('Missing question_id or response')

  db.getConnection((err, connection) => { // **Cambio: Obtención de conexión del pool**
    if (err) {
      console.error(err.message)
      return res.status(500).send('Failed while connecting to the database')
    }

    // Inserción de respuestas de la encuesta
    connection.query(`
      INSERT INTO Survey_Responses (question_id, user_id, response) 
      VALUES ${query}
    `, values, function (err) {
      connection.release() // **Cambio: Liberar conexión**
      if (err) {
        console.error(err.message)
        return res.status(500).send('Failed while inserting survey')
      }
      res.status(201).send('Survey created')
    })
  })
})

app.post('/trivia/categories', async (req, res) => {
  if (!req.body?.id) return res.status(409).json({ redirect: '/' })
  try {
    const dbCheckRes = await dbCheck({ res, checkTrivia: true, db, id: req.body.id })
    if (dbCheckRes.msg) return res.status(dbCheckRes.status).send(dbCheckRes.msg)
    if (dbCheckRes.jn) return res.status(dbCheckRes.status).json(dbCheckRes.jn)
    if (dbCheckRes.result !== false) return

    db.getConnection((err, connection) => { // **Cambio: Obtención de conexión del pool**
      if (err) {
        console.error(err.message)
        return res.status(500).send('Failed while connecting to the database')
      }
      // Consulta de categorías de trivia
      connection.query(`
        SELECT category_id, category_name FROM Trivia_Categories
      `, function (err, rows) {
        connection.release() // **Cambio: Liberar conexión**
        if (err) {
          console.error(err.message)
          return res.status(500).send('Failed while getting trivia categories')
        }
        res.status(200).send(rows.map(row => ({
          category_id: row.category_id,
          category_name: row.category_name
        })))
      })
    })
  } catch (err) {
    if (err.msg) return res.status(err.status).send(err.msg)
    if (err.jn) return res.status(err.status).json(err.jn)
  }
})

app.post('/trivia', (req, res) => {
  if (!req.query?.category_id) return res.status(400).send('Missing category_id')

  const played = req.body.played ? (req.body.played.find(i => parseInt(i.category_id) === parseInt(req.query.category_id)) ? req.body.played.find(i => parseInt(i.category_id) === parseInt(req.query.category_id)).questions_id : []) : []
  const queryCategoryId = parseInt(req.query.category_id)
  const placeholders = played ? played.map(() => '?').join(', ') : ''

  db.getConnection((err, connection) => { // **Cambio: Obtención de conexión del pool**
    if (err) {
      console.error(err.message)
      return res.status(500).send('Failed while connecting to the database')
    }

    connection.query(`
        SELECT question_id, category_id, question_text, correct_answer, fake_answer_1, fake_answer_2, fake_answer_3 FROM Trivia_Questions
        WHERE category_id = ?
        ${played.length > 0 ? `AND question_id NOT IN (${placeholders})` : ''}
        ORDER BY RAND()
        LIMIT 1
        `, played.length > 0 ? [queryCategoryId, ...played] : [queryCategoryId], function (err, rows) {
      connection.release() // **Cambio: Liberar conexión**
      if (err) {
        console.error(err.message)
        return res.status(500).send('Failed while getting trivia categories')
      }
      if (!rows[0]) return res.status(404).send('No trivia questions found')
      const row = rows[0]
      row.options = [row.correct_answer, row.fake_answer_1, row.fake_answer_2, row.fake_answer_3]
      delete row.correct_answer
      delete row.fake_answer_1
      delete row.fake_answer_2
      delete row.fake_answer_3
      res.status(200).send(row)
    })
  })
})

app.post('/trivia/send', (req, res) => { // resultados de la trivia+
  if (!req.body?.id) return res.status(409).json({ redirect: '/' })

  if (!Array.isArray(req.body.results) || !req.body.userInfo) return res.status(400).send('Missing trivia')
  if (req.body.results.filter(i => i.question_id !== undefined && i.is_correct !== undefined && i.response_time !== undefined).length < req.body.results.length) return res.status(400).send('Missing question_id or response')
  const query = req.body.results.map(ans => '(?, ?, ?, ?)').join(', ')
  const values = req.body.results.map(ans => [ans.question_id, req.body.id, ans.is_correct ? 1 : 0, ans.response_time]).flat()

  db.getConnection((err, connection) => { // **Cambio: Obtención de conexión del pool**
    if (err) {
      console.error(err.message)
      return res.status(500).send('Failed while connecting to the database')
    }

    // Inserción de respuestas de trivia
    connection.query(`
      INSERT INTO Trivia_Responses (question_id, user_id, is_correct, response_time) 
      VALUES ${query}
    `, values, function (err) {
      if (err) {
        connection.release() // **Cambio: Liberar conexión**
        console.error(err.message)
        return res.status(500).send('Failed while inserting trivia results')
      }

      // Actualización de información del usuario
      connection.query(`
        UPDATE Users
        SET bonus_category_id = ?
        WHERE user_id = ?
        `, [req.body.userInfo.bonus_category_id, req.body.id], function (err) {
        connection.release() // **Cambio: Liberar conexión**
        if (err) {
          console.error(err.message)
          return res.status(500).send('Failed while updating user info')
        }
        res.status(201).send('Trivia results created and User info updated')
      })
    })
  })
})

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`)
})
