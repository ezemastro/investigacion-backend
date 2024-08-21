import express from 'express'
import sqlite3 from 'sqlite3'
import cookieParser from 'cookie-parser'
import { hash } from './utils/hash.js'
import { userSchema } from './utils/zod.js'
import { check } from './utils/check.js'
import cors from 'cors'

const { PORT, FRONTEND_URL } = process.env

sqlite3.verbose()
const db = new sqlite3.Database('./investigacion.db', sqlite3.OPEN_READWRITE, (err) => {
  if (err) console.error(err.message)
})
db.configure('busyTimeout', 5000)

const app = express()
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}))
app.use(express.json())
app.use(cookieParser())

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
  // Serializar las operaciones en la base de datos para evitar bloqueos
  db.serialize(() => {
    db.get('SELECT * FROM users WHERE email = ?', [hashedEmail], (err, row) => {
      if (err) {
        console.error(err.message)
        return res.status(500).send('Failed while getting email')
      }
      if (row) {
        return res.status(409).send('Email already exists')
      } else {
        db.run(`
          INSERT INTO users (email, age)
          VALUES (?, ?)
        `, [hashedEmail, age], function (err) {
          if (err) {
            console.error(err.message)
            return res.status(500).send('Failed while inserting email and age')
          }

          const id = this.lastID
          // Set cookies y responder
          res
            .clearCookie('id', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' })
            .clearCookie('email', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' })
            .cookie('id', id.toString(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 1000 })
            .cookie('email', hashedEmail, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 1000 })
            .status(201).send('User created')
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

  db.serialize(() => {
    db.all(`
      SELECT question_id, question_text, response_type, option_1, option_2, option_3, option_4 FROM survey_questions
      `, function (err, rows) {
      if (err) {
        console.error(err.message)
        res.status(500).send('Failed while getting survey')
        return
      }
      res.status(200).send(rows.map(row => ({
        question_id: row.question_id,
        question_text: row.question_text,
        response_type: row.response_type,
        options: [row.option_1, row.option_2, row.option_3, row.option_4]
      })))
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
  db.serialize(() => {
    db.run(`
      INSERT INTO survey_responses (question_id, user_id, response) 
      VALUES ${query}
    `, values, function (err) {
      if (err) {
        console.error(err.message)
        res.status(500).send('Failed while inserting survey')
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

  db.serialize(() => {
    db.all(`
    SELECT category_id, category_name FROM trivia_categories
    `, function (err, rows) {
      if (err) {
        console.error(err.message)
        res.status(500).send('Failed while getting trivia categories')
        return
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
  db.serialize(() => {
    db.get(`SELECT COUNT(*) AS count FROM trivia_questions WHERE category_id = ? AND question_id NOT IN (${placeholders})`, [queryCategoryId, ...played], function (err, row) {
      if (err) {
        console.error(err.message)
        res.status(500).send('Failed while getting trivia questions')
        return
      }
      if (row.count <= 0) return res.status(404).send('No trivia questions found')

      // select random trivia question
      const rnd = Math.floor(Math.random() * row.count)

      db.get(`
        SELECT question_id, category_id, question_text, correct_answer, fake_answer_1, fake_answer_2, fake_answer_3 FROM trivia_questions
        WHERE category_id = ?
        AND question_id NOT IN (${placeholders})
        LIMIT 1 OFFSET ?
        `, [queryCategoryId, ...played, rnd], function (err, row) {
        if (err) {
          console.error(err.message)
          res.status(500).send('Failed while getting trivia categories')
          return
        }
        if (!row) return res.status(404).send('No trivia questions found')
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
app.post('/trivia', async (req, res) => {
  const checkRes = await check(req, db)
  if (checkRes.err) return res.status(checkRes.status).send(checkRes.message)
  if (!checkRes.exist) return res.status(401).redirect(FRONTEND_URL + '/mail')
  if (checkRes.survey && !checkRes.trivia) return res.redirect(FRONTEND_URL + '/trivia')
  if (checkRes.survey && checkRes.trivia) return res.redirect(FRONTEND_URL + '/gracias')

  if (!Array.isArray(req.body.results) || !req.body.userInfo) return res.status(400).send('Missing trivia')
  const query = req.body.results.map(ans => '(?, ?, ?, ?)').join(', ')
  const values = req.body.results.map(ans => [ans.question_id, checkRes.id, ans.is_correct, ans.response_time]).flat()
  if (req.body.results.filter(i => i.question_id && i.is_correct && i.response_time).length < req.body.results.length) return res.status(400).send('Missing question_id or response')
  db.serialize(() => {
    db.run(`
      INSERT INTO trivia_responses (question_id, user_id, is_correct, response_time) 
      VALUES ${query}
    `, values, function (err) {
      if (err) {
        console.error(err.message)
        res.status(500).send('Failed while inserting survey')
      }
    })
    db.run(`
      UPDATE users
      SET bonus_category_id = ?
      `, req.body.userInfo.bonus_category_id, function (err) {
      if (err) {
        console.error(err.message)
        res.status(500).send('Failed while inserting user info')
      }
      res.status(201).send('Survey created and User info added')
    })
  })
})

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`)
})
