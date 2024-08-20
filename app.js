import express from 'express'
import dotenv from 'dotenv'
import sqlite3 from 'sqlite3'
import cookie from 'cookie' // https://expressjs.com/resources/middleware/cookie-parser.html
import { hash } from './utils/hash.js'
import { userSchema } from './utils/zod.js'
import { check } from './utils/check.js'
import cors from 'cors'
dotenv.config()
const { PORT } = process.env

sqlite3.verbose()
const db = new sqlite3.Database('./investigacion.db', sqlite3.OPEN_READWRITE, (err) => {
  if (err) console.error(err.message)
})
db.configure('busyTimeout', 5000)

const app = express()
app.use(cors())
app.use(express.json())

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
          console.log(id, typeof id)
          // Set cookies y responder
          res.setHeader('Set-Cookie',
            cookie.serialize('id', id.toString(), { httpOnly: true }) + ';' +
            cookie.serialize('email', hashedEmail, { httpOnly: true }))
            .status(201).send('User created')
        })
      }
    })
  })
})

app.get('/check', (req, res) => {
  const checkRes = check(req, db)
  if (checkRes.email && checkRes.id) {
    res.status(200).send('Authorized')
  } else {
    res.status(checkRes.status).send(checkRes.message)
  }
})
app.get('/survey', (req, res) => {
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
app.post('/survey', (req, res) => {
  const checkRes = check(req, db)
  if (!checkRes.email || !checkRes.id) {
    res.status(checkRes.status).send(checkRes.message)
  } else if (checkRes.email && checkRes.id) {
    if (!res.body.survey) return res.status(400).send('Missing survey')
    const query = req.body.survey.map(ans => '(?, ?, ?)').join(', ')
    const values = req.body.survey.map(ans => [ans.question_id, checkRes.id, ans.response]).flat()
    if (!req.body.survey.question_id || !req.body.survey.response) return res.status(400).send('Missing question_id or response')
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
  }
})

app.post('/trivia', (req, res) => {
  const checkRes = check(req, db)
  if (!checkRes.email || !checkRes.id) {
    res.status(checkRes.status).send(checkRes.message)
  } else if (checkRes.email && checkRes.id) {
    if (!res.body.survey) return res.status(400).send('Missing survey')

    db.run(`
      INSERT INTO survey_responses (question_id, user_id, response) 
      VALUES (%question_id, %user_id, %response)
    `, {
      question_id: req.body.survey.question_id,
      user_id: checkRes.id,
      response: req.body.survey.response
    }, function (err) {
      if (err) {
        console.error(err.message)
        res.status(500).send('Failed while inserting survey')
      }
      res.status(201).send('Survey created')
    })
  }
})
app.get('/trivia/categories', (req, res) => {
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
app.get('/trivia', (req, res) => {
  if (!req.query.category_id) {
    res.status(400).send('Missing category_id')
    return
  }
  const queryCategoryId = parseInt(req.query.category_id)
  db.get('SELECT COUNT(*) AS count FROM trivia_questions WHERE category_id = ?', [queryCategoryId], function (err, row) {
    if (err) {
      console.error(err.message)
      res.status(500).send('Failed while getting trivia questions')
      return
    }
    if (row.count <= 0) return res.status(404).send('No trivia questions found')

    // select random trivia question
    let rnd
    const played = Array.isArray(req.body)
      ? req.body.find(i => i.category_id === queryCategoryId)?.played || []
      : []
    if (played) {
      rnd = Math.floor(Math.random() * (row.count - played.length))
    } else rnd = Math.floor(Math.random() * row.count)

    const placeholders = played ? played.map(i => '?').join(', ') : ''
    db.get(`
      SELECT question_id, question_text, correct_answer, fake_answer_1, fake_answer_2, fake_answer_3 FROM trivia_questions
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
      res.status(200).send(row)
    })
  })
})
app.post('/trivia', (req, res) => {
  const checkRes = check(req, db)
  if (!checkRes.email || !checkRes.id) {
    res.status(checkRes.status).send(checkRes.message)
  } else if (checkRes.email && checkRes.id && req.body.question_id && req.body.is_correct && req.body.response_time) {
    db.run(`
      INSERT INTO trivia_responses (question_id, user_id, is_correct, response_time) 
      VALUES (%question_id, %user_id, %is_correct, %response_time)
    `, {
      question_id: req.body.question_id,
      user_id: checkRes.id,
      is_correct: req.body.is_correct,
      response_time: req.body.response_time
    }, function (err) {
      if (err) {
        console.error(err.message)
        res.status(500).send('Failed while inserting trivia answer')
      }
      res.status(201).send('Trivia answer created')
    })
  } else res.status(400).send('Missing data')
})

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`)
})
