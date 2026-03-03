const fs = require('fs');

const path = require('path');
const schemaPath = path.resolve(__dirname, 'prisma/schema.prisma');
let content = fs.readFileSync(schemaPath, 'utf8');

const targetStr = `  user User @relation("UserWithdrawalRequests", fields: [userId], references: [id])\r\n}`;

const idx = content.lastIndexOf(targetStr);

let cleanContent = '';

if (idx !== -1) {
    cleanContent = content.substring(0, idx + targetStr.length);
} else {
    // maybe \n instead of \r\n
    const targetStr2 = `  user User @relation("UserWithdrawalRequests", fields: [userId], references: [id])\n}`;
    const idx2 = content.lastIndexOf(targetStr2);
    cleanContent = content.substring(0, idx2 + targetStr2.length);
}

cleanContent += `

model LoginLog {
  id        Int      @id @default(autoincrement())
  userId    Int
  email     String
  ipAddress String?
  userAgent String?
  createdAt DateTime @default(now())
  user      User     @relation("UserLoginLogs", fields: [userId], references: [id])
}

model AccountDeletionRequest {
  id        Int      @id @default(autoincrement())
  userId    Int
  reason    String
  status    String   @default("PENDING")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation("UserDeletionRequests", fields: [userId], references: [id])
}
`;

cleanContent = cleanContent.replace(
    /withdrawalRequests WithdrawalRequest\[\] @relation\("UserWithdrawalRequests"\)/g,
    'withdrawalRequests WithdrawalRequest[] @relation("UserWithdrawalRequests")\n  loginLogs          LoginLog[]          @relation("UserLoginLogs")\n  deletionRequests   AccountDeletionRequest[] @relation("UserDeletionRequests")'
);

fs.writeFileSync(schemaPath, cleanContent, 'utf8');
console.log("Schema appended");
