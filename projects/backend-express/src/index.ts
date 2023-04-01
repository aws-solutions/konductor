const express = require ( 'express' ) ;
import { Response } from 'express';
import dotenv from 'dotenv' ;

dotenv.config();

const app = express();
const port : number = Number ( process.env.PORT ) || 8000 ;

app.get ( '/' , ( req : Request , res : Response ) => {
    res.send ( 'Hello World!' ) ;
});

app.listen ( port , () => {
    console.log ( `[server]: Server is running at http://localhost:${ port }` ) ;
});