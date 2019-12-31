import Twilio from 'twilio';
import Express from 'express';
import BodyParser from 'body-parser';
import Cron  from 'node-cron';
import Redis from 'redis';


const accountSid = 'AC53f46be8d6f0a6b7737777c75f102feb';
const authToken = '69ddf27362642bace2a500254ca69590';

const client = Twilio(accountSid, authToken);
const app = Express();

// Recuring events

Cron.schedule('0 00 * * *', () => startNewDay);
Cron.schedule('0 08 * * *', () => sendMorningMessage);


async function sendMorningMessage() {
  // Get all phone numbers
  const numbers = await Redis.keys('numbers-*');
  for (let i = 0; i < numbers.length; i++) {
    const today = new Date().toLocaleDateString();
    const allTasks = JSON.parse(await Redis.get(numbers[i]));
    const todaysTasks = allTasks[today];

    console.log(todaysTasks);
  }
}


async function startNewDay() {
  // Get all phone numbers
  const numbers = await Redis.keys('numbers-*');
  for (let i = 0; i < numbers.length; i++) {
    
    // Get all tasks associated with the number
    const allTasks = JSON.parse(await Redis.get(numbers[i]));

    // helper variables for yesterday and today
    // MM/DD/YYYY
    const today = new Date().toLocaleDateString();
    const yesterday = new Date(new Date().setDate(new Date().getDate() - 1)).toLocaleDateString();

    // Set today's tasks to be the same as yesterday's tasks
    const todaysTasks = Object.assign(allTasks[yesterday]);

    // Zero out all of today's task.
    Object.keys(todaysTasks).forEach(task => {
      todaysTasks[task] = false;
    });

    // Attach today's tasks to the number object
    allTasks[today] = todaysTasks;

    // write back to redis
    await Redis.set(numbers[i], JSON.stringify(allTasks));
  }
}


// Task Functions

async function modifyTask(number, task, modifier) {
  const today = new Date().toLocaleDateString();
  const allTasks = JSON.parse(await Redis.get(`numbers-${number}`));

  switch (modifier) {
    case 'add':
      allTasks[today][task] = false;
      break;
    case 'remove':
      delete allTasks[today][task];
      break;
    case 'complete':
      allTasks[today][task] = true;
      break;
    default:
      break;
  }

  await Redis.set(`numbers-${number}`, JSON.stringify(allTasks));
}

async function completeTask(number, task) {
  const today = new Date().toLocaleDateString();
  const allTasks = JSON.parse(await Redis.get(`numbers-${number}`));
  allTasks[today][task] = true;
  await Redis.set(`numbers-${number}`, JSON.stringify(allTasks));
}

// API
app.use(BodyParser.json());

app.post('/message', async (req, res) => {

  // Get phone number
  // Look for key that matches string sent in 
  // ie: KEYS +18057489135{string}*
  // +18057489135run-5m={01/01/2019=true,....,}
  // In morning at 8am send Whatsapp - you did great yesterday, keep it up today!
  //  
  //]

  console.log(req.body)
});

app.listen(8080, () => {
  console.log('Listening');
});

// (async () => {
//   try {
//     const response = await client.messages.create({
//       from: 'whatsapp:+14155238886',
//       body: `*Daily Tasks*
//       ⬜  - 5m Meditate
//       ⬜  - 30m Exercise
//       ✅  - 30m Write
//       `,
//       to: 'whatsapp:+18057489135'
//     })

//     console.log(response);
//   } catch (err) {
//     console.log(err)
//   }
    
// })();