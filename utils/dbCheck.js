/* eslint-disable prefer-promise-reject-errors */
const CheckSurvey = ({ id, connection, res }) => {
  return new Promise((resolve, reject) => {
    connection.query('SELECT * FROM Survey_Responses WHERE user_id = ?', [id], (err, results) => {
      if (err) {
        console.error(err.message)
        reject(err)
      }
      if (results.length > 0) {
        resolve(true)
      } else resolve(false)
    })
  })
}

export default async function dbCheck ({ res, newUser, checkTrivia, checkSurvey, age, hashedEmail, id, db }) {
  if (!db) return
  return new Promise((resolve, reject) => {
    if (newUser) {
      db.getConnection((err, connection) => {
        if (err) {
          console.error(err.message)
          reject({ msg: 'Failed while connecting to the database', status: 500 })
        }
        connection.query('SELECT * FROM Users WHERE email = ?', [hashedEmail], async (err, results) => {
          if (err) {
            console.error(err.message)
            connection.release()
            resolve({ msg: 'Failed while getting email', status: 500 })
          }
          if (results && results.length > 0) {
            if (results[0].bonus_category_id) {
              connection.release()
              resolve({ status: 409, jn: { redirect: '/gracias' } })
            } else {
              if (checkTrivia) {
                connection.release()
                resolve({ result: false })
              }
              CheckSurvey({ id: results[0].user_id, connection })
                .then((checkSruveyRes) => {
                  connection.release()
                  if (checkSruveyRes) {
                    resolve({ status: 409, jn: { id: results[0].user_id, redirect: '/trivia' } })
                  } else {
                    resolve({ status: 409, jn: { id: results[0].user_id, redirect: '/encuesta' } })
                  }
                }).catch(() => {
                  connection.release()
                  reject({ msg: 'Failed while checking survey', status: 500 })
                })
            }
          } else {
            // si no existe
            connection.query('INSERT INTO Users (email, age) VALUES (?, ?)', [hashedEmail, age], (err, results) => {
              if (err) {
                console.error(err.message)
                connection.release()
                reject({ msg: 'Failed while inserting user', status: 500 })
              }
              console.log(results)
              const resId = results.insertId
              connection.release()
              resolve({ result: resId })
            })
          }
        })
      })
    }

    if (checkSurvey) {
      db.getConnection((err, connection) => {
        if (err) {
          console.error(err.message)
          reject({ msg: 'Failed while connecting to the database', status: 500 })
        }
        CheckSurvey({ id, connection })
          .then((CheckSruveyRes) => {
            connection.release()
            if (CheckSruveyRes) {
              resolve({ status: 409, jn: { redirect: '/trivia' } })
            } else {
              resolve({ result: false })
            }
          }).catch(() => {
            connection.release()
            reject({ msg: 'Failed while checking survey', status: 500 })
          })
      })
    }

    if (checkTrivia) {
      db.getConnection((err, connection) => {
        if (err) {
          console.error(err.message)
          reject({ msg: 'Failed while connecting to the database', status: 500 })
        }
        connection.query('SELECT * FROM Users WHERE user_id = ?', [id], async (err, results) => {
          if (err) {
            console.error(err.message)
            connection.release()
            resolve({ msg: 'Failed while getting trivia responses', status: 500 })
          }
          connection.release()
          if (results[0].bonus_category_id) {
            resolve({ status: 409, jn: { redirect: '/gracias' } })
          } else {
            resolve({ result: false })
          }
        })
      })
    }
  })
}
