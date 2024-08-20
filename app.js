import express from 'express'
import dotenv from 'dotenv'
import sqlite3 from 'sqlite3'
import cookie from 'cookie' // https://expressjs.com/resources/middleware/cookie-parser.html
import { hash } from './utils/hash.js'
import { userSchema } from './zod.js'
import { check } from './utils/check.js'
dotenv.config()
const { PORT } = process.env

sqlite3.verbose()
const db = new sqlite3.Database('./investigacion.db', {}, (err) => {
  if (err) console.error(err.message)
})

const app = express()
app.use(express.json())

app.post('/mail', (req, res) => {
  const { email } = req.body
  const age = parseInt(req.body.age)

  // if err
  if (!userSchema.safeParse({ email, age }).success) {
    res.status(400).json({
      email: userSchema.shape.email.safeParse(email).success,
      age: userSchema.shape.age.safeParse(age).success
    })
  } else {
    const hashedEmail = hash(email)
    db.get('SELECT * FROM users WHERE email = ?', [hashedEmail], (err, row) => {
      if (err) {
        console.error(err.message)
        res.status(500).send('Failed while getting email')
      }
      if (row) {
        res.status(409).send('Email already exists')
      } else {
        db.run(`
          INSERT INTO users (email, age)
          VALUES (?, ?)
          `, [email, age], function (err) {
          if (err) {
            console.error(err.message)
            res.status(500).send('Failed while inserting email and age')
          }
          const id = this.lastID
          // set cookie
          res.setHeader('Set-Cookie',
            cookie.serialize('id', id.toString(), { httpOnly: true }) + ';' +
            cookie.serialize('email', hashedEmail, { httpOnly: true }))
            .status(201).send('User created')
        })
      }
    })
  }
})
app.get('/check', (req, res) => {
  const checkRes = check(req, db)
  if (checkRes.email && checkRes.id) {
    res.status(200).send('Authorized')
  } else {
    res.status(checkRes.status).send(checkRes.message)
  }
})
app.post('/survey', (req, res) => {
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
app.get('/survey', (req, res) => {
  db.all(`
    SELECT question_id, question_text, response_type FROM survey_questions
    `, function (err, rows) {
    if (err) {
      console.error(err.message)
      res.status(500).send('Failed while getting survey')
      return
    }
    res.status(200).send(rows.map(row => ({
      question_id: row.question_id,
      question_text: row.question_text,
      response_type: row.response_type
    })))
  })
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
