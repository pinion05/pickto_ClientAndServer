const express = require("express");
const app = express();
const cors = require("cors");
const fs = require("fs");
const cookieParser = require("cookie-parser");
const mysql = require("mysql");
const bodyParser = require("body-parser");
const port = process.env.PORT || 5000;
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const AWS = require("aws-sdk");
const myBucket = new AWS.S3();
const jwt = require("jsonwebtoken");

require("dotenv").config();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  cors({
    origin: `http://localhost:3000`,
    methods: ["GET", "POST", "DELETE"],
    credentials: true,
  })
);

//!                SQL 설정
const connection = mysql.createConnection({
  host: process.env.REACT_APP_MYSQL_HOST,
  user: process.env.REACT_APP_MYSQL_USER,
  password: process.env.REACT_APP_MYSQL_PASSWORD,
  port: process.env.REACT_APP_MYSQL_PORT,
  database: process.env.REACT_APP_MYSQL_DATABASE,
});
connection.connect();

//!                 AWS 설정
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.REACT_APP_REGION,
});

//!               회원가입
app.post("/api/register", (req, res) => {
  const { nickname, email, password } = req.body;
  connection.query(
    `
    INSERT INTO users
    (nickname, email, password)
    VALUES(?,?,?)`,
    [nickname, email, password],
    (err, rows, filed) => {
      // 에러 처리
      if (err) {
        console.error(err);
        res.status(500).send(err.message);
        return;
      }
      // 성공 시 HTTP 상태 코드 200 반환
      res.status(200).send("성공했습니다.");
    }
  );
});

//!               로그인
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  connection.query(
    `
    SELECT * FROM users 
    WHERE email=? AND password = ?`,
    [email, password],
    (err, rows, filed) => {
      const { id, nickname, email, password } = rows[0];
      console.log("로그인시도", id, nickname, email, password);
      if (rows.length === 0) {
        res.status(403).send("유저정보조회에 실패했습니다.");
        return;
      }
      if (err) {
        console.log(err);
        res.status(500).send("유저 조회중 에러 발생");
        return;
      }
      //*            로그인 승인처리
      try {
        const accessToken = jwt.sign(
          {
            id: id,
            nickname: nickname,
            email: email,
          },
          process.env.JWT_ACCESS_SECRET,
          {
            expiresIn: "1m",
            issuer: "pickto",
          }
        );
        const refreshToken = jwt.sign(
          {
            id: id,
            nickname: nickname,
            email: email,
          },
          process.env.JWT_REFRESH_SECRET,
          {
            expiresIn: "24h",
            issuer: "pickto",
          }
        );
        res.cookie("accessToken", accessToken, {
          secure: false,
          httpOnly: true,
        });

        res.cookie("refreshToken", refreshToken, {
          secure: false,
          httpOnly: true,
        });

        res.status(200).send("로그인허용됨");
      } catch (err) {
        console.log("토큰 발급중 에러발생");
        res.status(500).json(err);
      }
    }
  );
});

//!                posts 테이블의 모든 rows 전송
app.get("/api/post", (req, res) => {
  connection.query("SELECT * FROM posts", (err, rows, filde) => {
    if (err) {
      console.error(err);
      res.status(500).send(err);
    } else {
      res.status(200).send(rows);
    }
  });
});

//!                  게시글 업로드
app.post("/api/post", upload.single("file"), (req, res) => {
  //*                통신 잘되는지 테스트
  const { postID, uploaderID, postName, imgExtension } = req.body;
  const file = req.file;
  const arr = [postID, uploaderID, postName, imgExtension];
  for (const idx in arr) {
  }
  if (!file) {
    console.log("파일존재하지않음");
    res.status(500).send("파일 존재하지않음");
  }

  //*                 S3 업로드
  myBucket
    .putObject({
      ACL: "public-read",
      Body: fs.createReadStream(file.path),
      Bucket: process.env.REACT_APP_BUCKET,
      Key: file.originalname,
    })
    .on("httpUploadProgress", (evt) => {
      console.log("파일업로드중", evt);
    })
    .send((err) => {
      if (err) {
        console.error(err);
        res.status(500).send("S3 에러발생");
        return;
      } else {
        console.log("S3 파일업로드 완료");
        //*                         SQL INSERT
        connection.query(
          `
          INSERT INTO posts 
          (id, uploader_id, post_name, img_extension) 
          VALUES (?,?,?,?)`,
          [postID, uploaderID, postName, imgExtension],
          (err, results) => {
            if (err) {
              console.log("sql 에러발생");
              res.status(500).send(err);
            } else {
              console.log("SQL 업로드 성공");
              res.status(200).send("업로드완료");
            }
          }
        );
      }
    });
});

//!               추천여부 확인하기
app.get("/api/vote", (req, res) => {
  const postID = req.query.postID;
  const userID = req.query.userID;
  console.log(`postID = ${postID} userID = ${userID} `);
  connection.query(
    `
  SELECT * FROM likes
  WHERE user_id = ? AND post_id = ?;`,
    [userID, postID],
    (err, rows) => {
      if (err) {
        console.error(err);
        res.status(500).send(err);
      } else {
        // console.log(rows);
        res.status(200).send(rows);
        // .send(`받은값 유저아이디 = ${userID}  포스트 아이디 = ${postID}`);
      }
    }
  );
});

//!               추천 추가
app.post(`/api/vote`, (req, res) => {
  const postID = req.body.postID;
  const userID = req.body.userID;
  // console.log(`postId = ${postID} | userID = ${userID}`);
  connection.query(
    `
    INSERT INTO likes (user_id, post_id) 
    VALUES (?, ?);`,
    [userID, postID],
    (err, rows, filed) => {
      if (err) {
        console.log("투표 실패");
        res.status(500).send(err);
      } else {
        console.log("투표 성공");
        res.status(200);
      }
    }
  );
});

//!                 추천 취소
app.delete(`/api/vote/:postid/:userid`, (req, res) => {
  const postId = req.params.postid;
  const userId = req.params.userid;
  // console.log(postId, userId);
  connection.query(
    `
  DELETE FROM likes
  WHERE user_id = ? AND post_id = ?;
  `,
    [userId, postId],
    (err, rows, filde) => {
      if (err) {
        console.log("에러발생");
        res.send(500).send(err);
        return;
      }
      console.log("투표취소됨");
      res.send(200);
    }
  );
});

//!                  게시글 삭제
app.delete(`/api/post/:postid/:extension`, (req, res) => {
  const postId = req.params.postid;
  const extension = req.params.extension;
  const objectKey = postId + `.` + extension;
  console.log(`삭제할 오브젝트키 = ` + objectKey);
  //*                       S3 객체 삭제
  myBucket.deleteObject(
    {
      Bucket: process.env.REACT_APP_BUCKET,
      Key: `${objectKey}`,
    },
    (err, data) => {
      if (err) {
        console.log(`s3 삭제실패`);
        console.error(err);
        return;
      } else {
        console.log(`S3객체 ${objectKey} 삭제됨.`);

        connection.query(
          `
        DELETE FROM posts
        WHERE post_id = ?;
        `,
          [postId],
          (err, rows, filde) => {
            if (err) {
              console.log("에러발생");
              res.send(500).send(err);
              return;
            }
            console.log("투표취소됨");
            res.send(200);
          }
        );
      }
    }
  );
});

app.listen(port, () => {
  console.log(`server running on${port}`);
});
