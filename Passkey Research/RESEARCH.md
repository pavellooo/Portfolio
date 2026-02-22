# What are "passkeys"
Passkey-based authentication is a modern alternative to traditional password-based authentication, in which passwords inherently insecure for many reasons. 
Instead of relying a memorized password, passkeys use public-key (asymmetric) cryptography and secure hardware. 
For more details, check out the FIDO Alliance website.

# What exactly have I done so far?
Under the supervision of Dr. Sankardas Roy at BGSU, I received source code for a client-side rendered web application with a minimal passkey-based authentication setup.
I spent a lot of time researching how the passkey-based authentication works in conjunction with web applications in general. 
I then noticed some major security weaknesses in the web app he gave me, as well as identified multiple places in which it could be improved, such as session management.
I implemented a token-based session architecture (JWT) and incorporated it with the passkey-based authentication. I also streamlined routing and fixed some minor bugs.
Then, I deployed it onto the internet using a service called "Heroku". The current URL is: https://passkey-tictactoe-spa-f5b6f75d5241.herokuapp.com/login
This took a lot of trial and error, but after forking it onto a separate repository and hooking it up to a database addon, it is working as intended.

Next, I took all of the challenges and solutions I encountered and organized them into a 6-page paper following IEEE guidelines. The paper was officially submitted on Feb. 15, 2026.
The deadline was extended, and we saw lots of room for improvement. We are currently in a revision phase, and will soon be submitting a more polished version in the upcoming weeks.

# What is planned next?
So far, this project only covers one class of web applications: client-side rendered (specifically with React). 
After finalizing and submitting this paper, we plan to find an open source server-side rendered web application and perform a similar process on that. 
By doing so, we can compare and contrast how different passkey-based authentication is for both major web application rendering types. We can identify the challenges and solutions, and provide a guide for other developers to follow.
Session management is typically not done with JWTs, and is instead done with a session ID in the database. This may interact differently with passkeys, and we wish to report on it.
By covering two web application rendering types, we hope to demonstrate how passkeys can be implemented in both systems, and compare the differences. 

We will write a second paper and publish our findings. There is an Undergraduate Research Symposium in April 2026 in which we will have the opportunity to show our results.
