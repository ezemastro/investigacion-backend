import express from 'express'
import dotenv from 'dotenv'
import sqlite3 from 'sqlite3'
import { userSchema } from './zod.js'
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

  if (!userSchema.safeParse({ email, age }).success) {
    res.status(400).json({
      email: userSchema.shape.email.safeParse(email).success,
      age: userSchema.shape.age.safeParse(age).success
    })
  } else {
    // crypto email
    // verificar email en la db

    db.run(`
      INSERT INTO users (email, age)
      VALUES (?, ?)
      `, [email, age], function (err) {
      if (err) {
        console.error(err.message)
        res.status(500).send('Failed while inserting email and age')
      }
      // aca tengo el id, guardarlo en la cookie
      // o a lo mejor mejor usar el mail como primary key, mas seguro
      console.log(this.lastID)
      // https://www.npmjs.com/package/promised-sqlite3
    })
  }
})
// crear la ruta check token para que el frontend verifique si el token es valido y si mostrar la pagina

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`)
})
