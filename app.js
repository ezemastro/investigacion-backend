import express from 'express'
import mysql from 'mysql2'
import cookieParser from 'cookie-parser'
import { hash } from './utils/hash.js'
import { userSchema } from './utils/zod.js'
import { check } from './utils/check.js'
import cors from 'cors'

const { PORT, FRONTEND_URL, DB_HOST, DB_USER, DB_PASSWORD, DB_DATABASE, DB_PORT } = process.env

const db = mysql.createPool({ // **Cambio: Creación de pool de conexiones en lugar de base de datos SQLite**
  host: DB_HOST ?? 'wvk.h.filess.io', // Cambia esto según tu configuración
  user: DB_USER ?? 'investigacion_questionus', // Cambia esto según tu configuración
  password: DB_PASSWORD ?? '5274ae2fcd1b4273eed318741f76e43befe3e9a2', // Cambia esto según tu configuración
  database: DB_DATABASE ?? 'investigacion_questionus', // Cambia esto según tu configuración
  port: DB_PORT ?? '3307'
})

const app = express()
app.use(cors({
  origin: [FRONTEND_URL, 'http://localhost:5173'],
  credentials: true
}))
app.use(express.json())
app.use(cookieParser())

app.get('/download-db', (req, res) => {
  res.download('./investigacion.db')
})

app.post('/mail', (req, res) => {
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
  console.log(hashedEmail)

  // Uso del pool de conexiones
  db.getConnection((err, connection) => { // **Cambio: Obtención de conexión del pool**
    if (err) {
      console.error(err.message)
      return res.status(500).send('Failed while connecting to the database')
    }

    // Consulta para verificar si el email ya existe
    connection.query('SELECT * FROM users WHERE email = ?', [hashedEmail], (err, results) => { // **Cambio: Uso de query en lugar de get**
      if (err) {
        console.error(err.message)
        connection.release() // **Cambio: Liberar conexión**
        return res.status(500).send('Failed while getting email')
      }
      if (results.length > 0) {
        connection.release() // **Cambio: Liberar conexión**
        return res.status(409).send('Email already exists')
      } else {
        // Inserción del nuevo usuario
        connection.query('INSERT INTO users (email, age) VALUES (?, ?)', [hashedEmail, age], function (err) { // **Cambio: Uso de query en lugar de run**
          if (err) {
            console.error(err.message)
            connection.release() // **Cambio: Liberar conexión**
            return res.status(500).send('Failed while inserting email and age')
          }

          const id = this.insertId // **Cambio: Uso de insertId en lugar de lastID**

          // Set cookies y responder
          res
            .clearCookie('id', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' })
            .clearCookie('email', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' })
            .cookie('id', id.toString(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 1000 })
            .cookie('email', hashedEmail, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 1000 })
            .status(201).send('User created')

          connection.release() // **Cambio: Liberar conexión**
        })
      }
    })
  })
})

app.get('/survey', async (req, res) => {
  const checkRes = await check(req, db)
  if (checkRes.err) return res.status(checkRes.status).send(checkRes.message)
  if (!checkRes.exist) return res.status(401).redirect(FRONTEND_URL + '/mail')
  if (checkRes.survey && !checkRes.trivia) return res.redirect(FRONTEND_URL + '/trivia')
  if (checkRes.survey && checkRes.trivia) return res.redirect(FRONTEND_URL + '/gracias')

  db.getConnection((err, connection) => { // **Cambio: Obtención de conexión del pool**
    if (err) {
      console.error(err.message)
      return res.status(500).send('Failed while connecting to the database')
    }

    connection.query('SELECT question_id, question_text, response_type, option_1, option_2, option_3, option_4 FROM survey_questions', (err, rows) => { // **Cambio: Uso de query en lugar de all**
      if (err) {
        console.error(err.message)
        connection.release()
        return res.status(500).send('Failed while getting survey')
      }

      res.status(200).send(rows.map(row => ({
        question_id: row.question_id,
        question_text: row.question_text,
        response_type: row.response_type,
        options: [row.option_1, row.option_2, row.option_3, row.option_4]
      })))
      connection.release()
    })
  })
})
app.post('/survey', async (req, res) => {
  const checkRes = await check(req, db)
  if (checkRes.err) return res.status(checkRes.status).send(checkRes.message)
  if (!checkRes.exist) return res.status(401).redirect(FRONTEND_URL + '/mail')
  if (checkRes.survey && !checkRes.trivia) return res.redirect(FRONTEND_URL + '/trivia')
  if (checkRes.survey && checkRes.trivia) return res.redirect(FRONTEND_URL + '/gracias')

  if (!Array.isArray(req.body)) return res.status(400).send('Missing survey')
  const query = req.body.map(ans => '(?, ?, ?)').join(', ')
  const values = req.body.map(ans => [ans.question_id, checkRes.id, ans.response]).flat()
  if (req.body.filter(i => i.question_id && i.response).length < req.body.length) return res.status(400).send('Missing question_id or response')

  db.getConnection((err, connection) => { // **Cambio: Obtención de conexión del pool**
    if (err) {
      console.error(err.message)
      return res.status(500).send('Failed while connecting to the database')
    }

    // Inserción de respuestas de la encuesta
    connection.query(`
      INSERT INTO survey_responses (question_id, user_id, response) 
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

app.get('/trivia/categories', async (req, res) => {
  const checkRes = await check(req, db)
  if (checkRes.err) return res.status(checkRes.status).send(checkRes.message)
  if (!checkRes.exist) return res.status(401).redirect(FRONTEND_URL + '/mail')
  if (checkRes.survey && !checkRes.trivia) return res.redirect(FRONTEND_URL + '/trivia')
  if (checkRes.survey && checkRes.trivia) return res.redirect(FRONTEND_URL + '/gracias')

  db.getConnection((err, connection) => { // **Cambio: Obtención de conexión del pool**
    if (err) {
      console.error(err.message)
      return res.status(500).send('Failed while connecting to the database')
    }

    // Consulta de categorías de trivia
    connection.query(`
      SELECT category_id, category_name FROM trivia_categories
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
})

app.post('/trivia', async (req, res, next) => {
  if (!req.query.category_id) return next()

  const checkRes = await check(req, db)
  if (checkRes.err) return res.status(checkRes.status).send(checkRes.message)
  if (!checkRes.exist) return res.status(401).redirect(FRONTEND_URL + '/mail')
  if (checkRes.survey && !checkRes.trivia) return res.redirect(FRONTEND_URL + '/trivia')
  if (checkRes.survey && checkRes.trivia) return res.redirect(FRONTEND_URL + '/gracias')

  const played = req.body.played ? req.body.played.find(i => i.category_id === req.query.category_id)?.questions_id : []
  const queryCategoryId = parseInt(req.query.category_id)
  const placeholders = played ? played.map(i => '?').join(', ') : ''

  db.getConnection((err, connection) => { // **Cambio: Obtención de conexión del pool**
    if (err) {
      console.error(err.message)
      return res.status(500).send('Failed while connecting to the database')
    }

    // Consulta de la cantidad de preguntas de trivia
    connection.query(`SELECT COUNT(*) AS count FROM trivia_questions WHERE category_id = ? AND question_id NOT IN (${placeholders})`, [queryCategoryId, ...played], function (err, rows) {
      if (err) {
        connection.release() // **Cambio: Liberar conexión**
        console.error(err.message)
        return res.status(500).send('Failed while getting trivia questions')
      }
      if (rows[0].count <= 0) {
        connection.release() // **Cambio: Liberar conexión**
        return res.status(404).send('No trivia questions found')
      }

      // Selección de pregunta de trivia aleatoria
      const rnd = Math.floor(Math.random() * rows[0].count)

      connection.query(`
        SELECT question_id, category_id, question_text, correct_answer, fake_answer_1, fake_answer_2, fake_answer_3 FROM trivia_questions
        WHERE category_id = ?
        AND question_id NOT IN (${placeholders})
        LIMIT 1 OFFSET ?
        `, [queryCategoryId, ...played, rnd], function (err, rows) {
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
})

app.post('/trivia/results', async (req, res) => { // **Cambio: Agregada la ruta /trivia/results para evitar colisión con la ruta /trivia**
  const checkRes = await check(req, db)
  if (checkRes.err) return res.status(checkRes.status).send(checkRes.message)
  if (!checkRes.exist) return res.status(401).redirect(FRONTEND_URL + '/mail')
  if (checkRes.survey && !checkRes.trivia) return res.redirect(FRONTEND_URL + '/trivia')
  if (checkRes.survey && checkRes.trivia) return res.redirect(FRONTEND_URL + '/gracias')

  if (!Array.isArray(req.body.results) || !req.body.userInfo) return res.status(400).send('Missing trivia')
  const query = req.body.results.map(ans => '(?, ?, ?, ?)').join(', ')
  const values = req.body.results.map(ans => [ans.question_id, checkRes.id, ans.is_correct, ans.response_time]).flat()
  if (req.body.results.filter(i => i.question_id && i.is_correct && i.response_time).length < req.body.results.length) return res.status(400).send('Missing question_id or response')

  db.getConnection((err, connection) => { // **Cambio: Obtención de conexión del pool**
    if (err) {
      console.error(err.message)
      return res.status(500).send('Failed while connecting to the database')
    }

    // Inserción de respuestas de trivia
    connection.query(`
      INSERT INTO trivia_responses (question_id, user_id, is_correct, response_time) 
      VALUES ${query}
    `, values, function (err) {
      if (err) {
        connection.release() // **Cambio: Liberar conexión**
        console.error(err.message)
        return res.status(500).send('Failed while inserting trivia results')
      }

      // Actualización de información del usuario
      connection.query(`
        UPDATE users
        SET bonus_category_id = ?
        `, req.body.userInfo.bonus_category_id, function (err) {
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
